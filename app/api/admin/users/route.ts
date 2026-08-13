import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { findAuthUserByEmail } from '@/lib/supabase/authUsers';
import { countOrgMembers } from '@/lib/supabase/orgMembers';
import { sendOrgAddedEmail } from '@/lib/email/orgAddedEmail';
import { UserRole } from '@/types/constants';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Handler HTTP `GET` deste endpoint (Next.js Route Handler).
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: me, error: meError } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (meError || !me?.organization_id) return json({ error: 'Profile not found' }, 404);
  if (me.role !== UserRole.ADMIN && me.role !== UserRole.SUPER_ADMIN) return json({ error: 'Forbidden' }, 403);

  const admin = createStaticAdminClient();
  const orgId = me.organization_id;

  // Membros da org = UNIÃO de quem tem a org ATIVA aqui (profiles) com quem tem
  // um VÍNCULO aqui (user_organizations), pra também mostrar membros multi-org
  // que estão com a org ativa em outro lugar. user_organizations precisa do
  // admin client: a RLS só deixa o usuário ver os próprios vínculos.
  const [membershipsRes, profilesRes] = await Promise.all([
    admin.from('user_organizations').select('user_id, role').eq('organization_id', orgId),
    admin
      .from('profiles')
      .select('id, email, role, organization_id, created_at, first_name, last_name, nickname')
      .eq('organization_id', orgId)
      .limit(500),
  ]);
  if (membershipsRes.error) return json({ error: membershipsRes.error.message }, 500);
  if (profilesRes.error) return json({ error: profilesRes.error.message }, 500);

  const membershipRoleByUser = new Map<string, string | null>();
  for (const m of membershipsRes.data || []) membershipRoleByUser.set(m.user_id, m.role ?? null);

  const profileById = new Map<string, Record<string, unknown>>();
  for (const p of profilesRes.data || []) profileById.set(p.id, p);

  const ids = new Set<string>();
  for (const p of profilesRes.data || []) ids.add(p.id);
  for (const m of membershipsRes.data || []) if (m.user_id) ids.add(m.user_id);

  // Detalhes de perfil dos membros cuja org ativa é OUTRA (não vieram acima).
  const missingIds = [...ids].filter((uid) => !profileById.has(uid));
  if (missingIds.length > 0) {
    const { data: extra, error: extraErr } = await admin
      .from('profiles')
      .select('id, email, role, organization_id, created_at, first_name, last_name, nickname')
      .in('id', missingIds);
    if (extraErr) return json({ error: extraErr.message }, 500);
    for (const p of extra || []) profileById.set(p.id, p);
  }

  const users = [...ids]
    .map((uid) => {
      const p = profileById.get(uid) as
        | { email?: string; role?: string; created_at?: string; first_name?: string | null; last_name?: string | null; nickname?: string | null }
        | undefined;
      if (!p) return null; // vínculo sem perfil (anomalia): não exibe linha em branco
      // Papel exibido = papel NESTA org (vínculo); fallback pro papel do perfil.
      const role = membershipRoleByUser.get(uid) ?? p.role ?? UserRole.VENDEDOR;
      return {
        id: uid,
        email: p.email ?? null,
        role,
        organization_id: orgId,
        created_at: p.created_at ?? null,
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        nickname: p.nickname ?? null,
        status: 'active' as const,
      };
    })
    .filter((u): u is NonNullable<typeof u> => u !== null)
    .sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0;
      const tb = b.created_at ? Date.parse(b.created_at) : 0;
      return tb - ta;
    });

  return json({ users });
}

const CreateUserSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
    role: z.enum([UserRole.ADMIN, UserRole.VENDEDOR]).default(UserRole.VENDEDOR),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

/**
 * POST /api/admin/users — Criação direta de usuário pelo admin da org:
 * email + senha prontos, sem convite (o admin passa o login pra pessoa).
 * Email com conta ativa em outra org NÃO é aceito aqui (senha de terceiros
 * nunca é alterada); nesse caso o caminho é o convite por link.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: me, error: meError } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (meError || !me?.organization_id) return json({ error: 'Profile not found' }, 404);
  if (me.role !== UserRole.ADMIN && me.role !== UserRole.SUPER_ADMIN) return json({ error: 'Forbidden' }, 403);

  const raw = await req.json().catch(() => null);
  const parsed = CreateUserSchema.safeParse(raw);
  if (!parsed.success) {
    const firstMsg = parsed.error.issues[0]?.message || 'Dados inválidos';
    return json({ error: firstMsg, details: parsed.error.flatten() }, 400);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { password, role } = parsed.data;
  const displayName = parsed.data.name?.trim() || email.split('@')[0];

  const admin = createStaticAdminClient();

  // Limite de usuários da organização (conta membros = perfis ativos aqui +
  // vínculos multi-org, igual à lista da tela de Usuários).
  const { data: org } = await admin
    .from('organizations')
    .select('max_users')
    .eq('id', me.organization_id)
    .single();
  if (org?.max_users) {
    const memberCount = await countOrgMembers(admin, me.organization_id);
    if (memberCount >= org.max_users) {
      return json(
        { error: `Limite de ${org.max_users} usuário(s) da organização atingido. Fale com o suporte pra aumentar.` },
        400
      );
    }
  }

  const userMetadata = { name: displayName, organization_id: me.organization_id, role };

  let userId: string;
  const existingAuthUser = await findAuthUserByEmail(admin, email);

  if (existingAuthUser) {
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, organization_id')
      .eq('id', existingAuthUser.id)
      .maybeSingle();

    // Convite pendente DESTA org (nunca logou): pode receber a senha nova.
    const isPendingHere = Boolean(
      existingAuthUser.invited_at &&
        !existingAuthUser.last_sign_in_at &&
        existingProfile?.organization_id === me.organization_id
    );

    if (existingProfile && !isPendingHere) {
      // Conta já existente: adiciona à organização SEM tocar na senha (a
      // informada é ignorada; a atual continua valendo) — um email pode
      // estar em várias orgs. A org nova aparece no seletor da pessoa.
      const { data: existingLink } = await admin
        .from('user_organizations')
        .select('user_id')
        .eq('user_id', existingAuthUser.id)
        .eq('organization_id', me.organization_id)
        .maybeSingle();
      if (existingLink || existingProfile.organization_id === me.organization_id) {
        return json({ error: 'Este email já é membro desta organização.' }, 400);
      }
      const { error: linkError } = await admin.from('user_organizations').upsert(
        { user_id: existingAuthUser.id, organization_id: me.organization_id, role },
        { onConflict: 'user_id,organization_id' }
      );
      if (linkError) return json({ error: linkError.message }, 400);
      // Avisa por email (via n8n): "você foi adicionado à org X" + acesso.
      const { data: orgRow } = await admin
        .from('organizations')
        .select('name')
        .eq('id', me.organization_id)
        .single();
      const origin = req.headers.get('origin') || new URL(req.url).origin;
      const emailSent = await sendOrgAddedEmail({
        email,
        orgName: orgRow?.name || 'sua nova organização',
        role,
        appUrl: origin,
      });
      return json({ ok: true, existing: true, emailSent, user: { id: existingAuthUser.id, email, role } }, 201);
    }

    // Login órfão (sobra de exclusão) ou convite pendente desta org:
    // reaproveita com a senha nova.
    const { error: updateError } = await admin.auth.admin.updateUserById(existingAuthUser.id, {
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (updateError) return json({ error: updateError.message }, 400);
    userId = existingAuthUser.id;
  } else {
    const { data: authData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (createError) return json({ error: createError.message }, 400);
    userId = authData.user.id;
  }

  const { error: profileError } = await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      name: displayName,
      first_name: displayName,
      organization_id: me.organization_id,
      role,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    // Rollback apenas da conta que ESTE fluxo criou.
    if (!existingAuthUser) {
      await admin.auth.admin.deleteUser(userId);
    }
    return json({ error: profileError.message }, 400);
  }

  await admin.from('user_organizations').upsert(
    {
      user_id: userId,
      organization_id: me.organization_id,
      role,
    },
    { onConflict: 'user_id,organization_id' }
  );

  // Login pronto: envia o acesso por email COM a senha (aqui ela é conhecida,
  // foi o admin quem definiu). Falha de email não desfaz a criação.
  const { data: orgRow } = await admin
    .from('organizations')
    .select('name')
    .eq('id', me.organization_id)
    .single();
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  const emailSent = await sendOrgAddedEmail({
    email,
    orgName: orgRow?.name || 'sua organização',
    role,
    appUrl: origin,
    password,
  });

  return json({ ok: true, emailSent, user: { id: userId, email, role } }, 201);
}
