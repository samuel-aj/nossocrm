/**
 * GET /api/deals/[dealId]/history  (membro que enxerga o lead)
 *   -> { available, since, events[], activityMeta{}, apiNotes[] }
 *
 * Histórico do lead para a linha do tempo unificada:
 * - events: alterações gravadas pelo banco (deal_events), com o NOME do autor
 *   resolvido (usuário, robô, agente de IA; integração e sistema sem nome).
 * - activityMeta: autor e edição das atividades e notas (só as gravadas depois
 *   da migração têm autor; as antigas vêm sem, nada é inventado).
 * - apiNotes: notas criadas pela API pública (tabela deal_notes).
 * available=false: a migração do histórico ainda não foi aplicada no banco.
 */
import { createClient } from '@/lib/supabase/server';
import { json, requireOrgUser } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ dealId: string }> };

type EventRow = {
  id: string;
  kind: string;
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  detail: Record<string, unknown> | null;
  actor_kind: 'user' | 'bot' | 'agent' | 'integration' | 'system';
  actor_id: string | null;
  created_at: string;
};

type ActivityMetaRow = {
  id: string;
  created_at: string | null;
  created_by: string | null;
  created_actor_kind: string | null;
  edited_at: string | null;
  edited_by: string | null;
};

type Profile = { id: string; name: string | null; first_name: string | null; last_name: string | null; nickname: string | null };

function profileName(p: Profile): string | null {
  return (p.nickname ?? '').trim() || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || (p.name ?? '').trim() || null;
}

const isMissingTable = (msg: string | undefined) => !!msg && /deal_events|created_by|does not exist|schema cache/i.test(msg);

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  // Visibilidade: o lead precisa ser visível para ESTE usuário (RLS do banco,
  // inclusive a restrição por responsável). Só depois lê com a service role.
  const supabase = await createClient();
  const { data: visible } = await supabase.from('deals').select('id').eq('id', dealId).eq('organization_id', orgId).maybeSingle();
  if (!visible) return json({ error: 'Lead não encontrado' }, 404);

  const admin = auth.admin;
  const [evRes, actRes, notesRes, sinceRes] = await Promise.all([
    admin
      .from('deal_events')
      .select('id, kind, field, old_value, new_value, detail, actor_kind, actor_id, created_at')
      .eq('deal_id', dealId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1000),
    admin
      .from('activities')
      .select('id, created_at, created_by, created_actor_kind, edited_at, edited_by')
      .eq('deal_id', dealId)
      .eq('organization_id', orgId),
    admin
      .from('deal_notes')
      .select('id, content, created_at, updated_at, created_by')
      .eq('deal_id', dealId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(300),
    // Primeiro registro do histórico novo na organização: os registros antigos
    // de "alteração" (atividades STATUS_CHANGE) valem só para antes disso.
    admin
      .from('deal_events')
      .select('created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const available = !evRes.error;
  if (evRes.error && !isMissingTable(evRes.error.message)) return json({ error: evRes.error.message }, 500);
  const events = ((evRes.data ?? []) as EventRow[]).reverse();
  let acts = (actRes.data ?? []) as ActivityMetaRow[];
  if (actRes.error) {
    // Sem as colunas de autor (migração não aplicada): ao menos a data de criação
    const { data } = await admin.from('activities').select('id, created_at').eq('deal_id', dealId).eq('organization_id', orgId);
    acts = ((data ?? []) as Array<{ id: string; created_at: string }>).map((a) => ({
      ...a,
      created_by: null,
      created_actor_kind: null,
      edited_at: null,
      edited_by: null,
    }));
  }
  const apiNotes = notesRes.error
    ? []
    : ((notesRes.data ?? []) as Array<{ id: string; content: string; created_at: string; updated_at: string | null; created_by: string | null }>);

  // Nomes dos autores
  const userIds = new Set<string>();
  const botIds = new Set<string>();
  const agentIds = new Set<string>();
  for (const e of events) {
    if (!e.actor_id) continue;
    if (e.actor_kind === 'user') userIds.add(e.actor_id);
    else if (e.actor_kind === 'bot') botIds.add(e.actor_id);
    else if (e.actor_kind === 'agent') agentIds.add(e.actor_id);
  }
  for (const a of acts) {
    if (a.created_by && (a.created_actor_kind ?? 'user') === 'user') userIds.add(a.created_by);
    if (a.edited_by) userIds.add(a.edited_by);
  }
  for (const n of apiNotes) if (n.created_by) userIds.add(n.created_by);

  const [profRes, botRes, agentRes] = await Promise.all([
    userIds.size
      ? admin.from('profiles').select('id, name, first_name, last_name, nickname').in('id', [...userIds])
      : Promise.resolve({ data: [] as Profile[] }),
    botIds.size ? admin.from('wa_bots').select('id, name').in('id', [...botIds]) : Promise.resolve({ data: [] }),
    agentIds.size ? admin.from('wa_ai_agents').select('id, name').in('id', [...agentIds]) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map<string, string>();
  for (const p of (profRes.data ?? []) as Profile[]) {
    const n = profileName(p);
    if (n) names.set(p.id, n);
  }
  for (const b of (botRes.data ?? []) as Array<{ id: string; name: string }>) names.set(b.id, b.name);
  for (const a of (agentRes.data ?? []) as Array<{ id: string; name: string }>) names.set(a.id, a.name);

  const activityMeta: Record<string, { createdAt: string | null; authorName: string | null; authorKind: string | null; editedAt: string | null; editedByName: string | null }> = {};
  for (const a of acts) {
    activityMeta[a.id] = {
      createdAt: a.created_at,
      authorKind: a.created_actor_kind,
      authorName: a.created_by ? names.get(a.created_by) ?? null : null,
      editedAt: a.edited_at,
      editedByName: a.edited_by ? names.get(a.edited_by) ?? null : null,
    };
  }

  return json({
    available,
    since: (sinceRes.data as { created_at?: string } | null)?.created_at ?? null,
    events: events.map((e) => ({ ...e, actor_name: e.actor_id ? names.get(e.actor_id) ?? null : null })),
    activityMeta,
    apiNotes: apiNotes.map((n) => ({
      id: n.id,
      content: n.content,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
      authorName: n.created_by ? names.get(n.created_by) ?? null : null,
    })),
  });
}
