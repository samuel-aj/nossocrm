/**
 * GET/POST /api/settings/lead-distribution — rodízio de responsáveis da org.
 *
 * A distribuição em si acontece no banco (trigger `assign_deal_owner` em
 * deals), então esta rota só lê/grava a configuração e devolve o retrato de
 * quanto cada pessoa recebeu. Leitura: qualquer membro. Escrita: admin.
 */
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';
import { UserRole } from '@/types/constants';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type Scoped = { id: string; role: string; organization_id: string };

async function auth(): Promise<{ ok: true; scoped: Scoped } | { ok: false; response: Response }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: json({ error: 'Unauthorized' }, 401) };

  const { data: me, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();
  if (error || !me?.organization_id) return { ok: false, response: json({ error: 'Profile not found' }, 404) };

  const scoped = await withTabOrg({ id: user.id, role: me.role, organization_id: me.organization_id });
  if (!scoped) return { ok: false, response: json({ error: 'Acesso negado a esta organização' }, 403) };
  return { ok: true, scoped };
}

const isAdmin = (role: string) => role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;

function displayName(p: {
  nickname?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  return (
    p.nickname ||
    `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ||
    p.email ||
    'Usuário'
  );
}

/** Membros da org: perfis com a org ATIVA aqui + vínculos multi-org. */
async function listMembers(admin: ReturnType<typeof createStaticAdminClient>, orgId: string) {
  const [profilesRes, membershipsRes] = await Promise.all([
    admin
      .from('profiles')
      .select('id, first_name, last_name, nickname, email, role')
      .eq('organization_id', orgId)
      .limit(300),
    admin.from('user_organizations').select('user_id, role').eq('organization_id', orgId),
  ]);
  if (profilesRes.error) throw new Error(profilesRes.error.message);

  const byId = new Map<string, { id: string; name: string; role: string }>();
  for (const p of profilesRes.data || []) {
    byId.set(p.id, { id: p.id, name: displayName(p), role: (p.role as string) || UserRole.VENDEDOR });
  }

  const missing = (membershipsRes.data || []).map(m => m.user_id).filter(id => id && !byId.has(id));
  if (missing.length) {
    const { data: extra } = await admin
      .from('profiles')
      .select('id, first_name, last_name, nickname, email, role')
      .in('id', missing);
    for (const p of extra || []) {
      byId.set(p.id, { id: p.id, name: displayName(p), role: (p.role as string) || UserRole.VENDEDOR });
    }
  }
  // Papel NESTA org vem do vínculo quando existe
  for (const m of membershipsRes.data || []) {
    const found = byId.get(m.user_id);
    if (found && m.role) found.role = m.role as string;
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function GET(req: Request) {
  const a = await auth();
  if (!a.ok) return a.response;
  const { scoped } = a;
  const admin = createStaticAdminClient();
  const orgId = scoped.organization_id;

  // Modo LEVE (?light=1): só os interruptores, pro modal de criação de lead
  // saber se o rodízio cobre criação manual — sem carregar membros/leads.
  if (new URL(req.url).searchParams.get('light')) {
    const { data } = await admin
      .from('organization_settings')
      .select('lead_distribution_enabled, lead_distribution_manual')
      .eq('organization_id', orgId)
      .maybeSingle();
    return json({
      enabled: Boolean(data?.lead_distribution_enabled),
      manual: Boolean(data?.lead_distribution_manual),
    });
  }

  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [members, settingsRes, rowsRes, matrixRes, boardsRes, dealsRes] = await Promise.all([
      listMembers(admin, orgId),
      admin
        .from('organization_settings')
        .select('lead_distribution_enabled, lead_distribution_manual, lead_distribution_since')
        .eq('organization_id', orgId)
        .maybeSingle(),
      admin.from('lead_distribution').select('user_id, weight, active').eq('organization_id', orgId),
      admin.from('lead_distribution_boards').select('user_id, board_id, active').eq('organization_id', orgId),
      admin
        .from('boards')
        .select('id, name')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .order('name'),
      admin
        .from('deals')
        .select('owner_id, created_at')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .not('owner_id', 'is', null)
        .gte('created_at', since30.toISOString())
        .limit(5000),
    ]);

    // Falha em QUALQUER leitura vira erro claro (sem vazar mensagem do banco)
    const falha = settingsRes.error || rowsRes.error || matrixRes.error || boardsRes.error || dealsRes.error;
    if (falha) {
      console.error('[lead-distribution GET]', falha.message);
      return json({ error: 'Não foi possível carregar a distribuição. Tente de novo em instantes.' }, 500);
    }

    const cfgByUser = new Map<string, { weight: number; active: boolean }>();
    for (const r of rowsRes.data || []) {
      cfgByUser.set(r.user_id as string, { weight: Number(r.weight) || 0, active: Boolean(r.active) });
    }

    const todayIso = startOfDay.toISOString();
    // Mesma janela que o trigger usa pra decidir: desde a última mudança das
    // fatias, limitada a 30 dias. É o número que explica a próxima escolha.
    const sinceIso =
      settingsRes.data?.lead_distribution_since &&
      (settingsRes.data.lead_distribution_since as string) > since30.toISOString()
        ? (settingsRes.data.lead_distribution_since as string)
        : since30.toISOString();

    const today = new Map<string, number>();
    const noPeriodo = new Map<string, number>();
    for (const d of dealsRes.data || []) {
      const uid = d.owner_id as string;
      const criado = d.created_at as string;
      if (criado >= sinceIso) noPeriodo.set(uid, (noPeriodo.get(uid) || 0) + 1);
      if (criado >= todayIso) today.set(uid, (today.get(uid) || 0) + 1);
    }

    const participants = members.map(m => {
      const cfg = cfgByUser.get(m.id);
      return {
        userId: m.id,
        name: m.name,
        role: m.role,
        weight: cfg?.weight ?? 0,
        active: cfg?.active ?? false,
        leadsToday: today.get(m.id) || 0,
        leadsPeriodo: noPeriodo.get(m.id) || 0,
      };
    });

    // Só o que está DESLIGADO vira registro; a UI trata ausência como ligado.
    const matrixOff: string[] = (matrixRes.data || [])
      .filter(r => r.active === false)
      .map(r => `${r.user_id}_${r.board_id}`);

    return json({
      isAdmin: isAdmin(scoped.role),
      enabled: Boolean(settingsRes.data?.lead_distribution_enabled),
      manual: Boolean(settingsRes.data?.lead_distribution_manual),
      since: (settingsRes.data?.lead_distribution_since as string) || null,
      participants,
      boards: (boardsRes.data || []).map(b => ({ id: b.id as string, name: b.name as string })),
      matrixOff,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

const SaveSchema = z
  .object({
    enabled: z.boolean(),
    manual: z.boolean(),
    participants: z
      .array(
        z.object({
          userId: z.string().uuid(),
          weight: z.number().min(0).max(100),
          active: z.boolean(),
        })
      )
      .max(300),
    matrixOff: z.array(z.string().max(80)).max(5000),
  })
  .strict();

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const a = await auth();
  if (!a.ok) return a.response;
  const { scoped } = a;
  if (!isAdmin(scoped.role)) return json({ error: 'Forbidden' }, 403);

  const parsed = SaveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const admin = createStaticAdminClient();
  const orgId = scoped.organization_id;
  const { enabled, manual, participants, matrixOff } = parsed.data;

  // Só entra no rodízio quem é membro daqui (payload não define quem existe)
  const members = new Set((await listMembers(admin, orgId)).map(m => m.id));
  const validos = participants.filter(p => members.has(p.userId));

  const now = new Date().toISOString();
  const upsert = await admin.from('lead_distribution').upsert(
    validos.map(p => ({
      organization_id: orgId,
      user_id: p.userId,
      weight: Math.round(p.weight * 1000) / 1000,
      active: p.active,
      updated_at: now,
    })),
    { onConflict: 'organization_id,user_id' }
  );
  if (upsert.error) return json({ error: upsert.error.message }, 500);

  // Quem não é mais membro daqui sai do rodízio (senão continuaria recebendo)
  const idsValidos = new Set(validos.map(p => p.userId));
  const { data: existentes } = await admin
    .from('lead_distribution')
    .select('user_id')
    .eq('organization_id', orgId);
  const remover = (existentes || []).map(r => r.user_id as string).filter(id => !idsValidos.has(id));
  if (remover.length) {
    await admin.from('lead_distribution').delete().eq('organization_id', orgId).in('user_id', remover);
  }

  // Matriz por board: sincroniza as exceções SEM janela destrutiva (nada de
  // delete-tudo-depois-insere: se o insert falhasse, as exceções sumiam e todo
  // mundo voltava a receber de todos os boards). Upsert do estado novo e
  // remoção por id só do que deixou de existir.
  const orgBoards = new Set(
    ((await admin.from('boards').select('id').eq('organization_id', orgId)).data || []).map(
      b => b.id as string
    )
  );
  const offRows = matrixOff
    .map(k => {
      const [userId, boardId] = k.split('_');
      return { userId, boardId };
    })
    // só gente da org E board da org (board alheio seria dado sujo inerte)
    .filter(r => r.userId && r.boardId && members.has(r.userId) && orgBoards.has(r.boardId));

  if (offRows.length) {
    const up = await admin.from('lead_distribution_boards').upsert(
      offRows.map(r => ({
        organization_id: orgId,
        user_id: r.userId,
        board_id: r.boardId,
        active: false,
      })),
      { onConflict: 'organization_id,user_id,board_id' }
    );
    if (up.error) {
      console.error('[lead-distribution POST matriz]', up.error.message);
      return json({ error: 'Não foi possível salvar as exceções por board.' }, 500);
    }
  }

  const chaveNova = new Set(offRows.map(r => `${r.userId}_${r.boardId}`));
  const { data: atuais } = await admin
    .from('lead_distribution_boards')
    .select('id, user_id, board_id')
    .eq('organization_id', orgId);
  const sobras = (atuais || [])
    .filter(r => !chaveNova.has(`${r.user_id}_${r.board_id}`))
    .map(r => r.id as string);
  if (sobras.length) {
    await admin.from('lead_distribution_boards').delete().in('id', sobras);
  }

  const settings = await admin.from('organization_settings').upsert(
    {
      organization_id: orgId,
      lead_distribution_enabled: enabled,
      lead_distribution_manual: manual,
      // Marco zero: mudou a regra, a contagem do rodízio recomeça
      lead_distribution_since: now,
      updated_at: now,
    },
    { onConflict: 'organization_id' }
  );
  if (settings.error) return json({ error: settings.error.message }, 500);

  return json({ ok: true });
}
