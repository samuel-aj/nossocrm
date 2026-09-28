import { createClient } from '@/lib/supabase/server';
import { json, requireOrgUser } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { cursorFilter, decodeCursor, paginateTimeline, type TimelineCursor } from '@/features/deals/lead/timelinePage';
import type { DealEvent } from '@/features/deals/lead/useDealHistory';
import type { DbActivity } from '@/lib/supabase/activities';
export const runtime = 'nodejs';
type EventRow = Omit<DealEvent, 'actor_name'>;
type ActivityRow = DbActivity & { created_by: string | null; created_actor_kind: string | null; edited_at: string | null; edited_by: string | null };
type NoteRow = { id: string; content: string; created_at: string; updated_at: string | null; created_by: string | null };
type Profile = { id: string; name: string | null; first_name: string | null; last_name: string | null; nickname: string | null };

function profileName(p: Profile): string | null {
  return (p.nickname ?? '').trim() || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || (p.name ?? '').trim() || null;
}


export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) return json({ error: 'ID inválido' }, 400);
  let cursor: TimelineCursor | null = null;
  try { const raw = new URL(req.url).searchParams.get('cursor'); if (raw) cursor = decodeCursor(raw); }
  catch { return json({ error: 'Cursor inválido' }, 400); }
  const orgId = auth.user.organizationId;
  const supabase = await createClient();
  const { data: visible, error: visibilityError } = await supabase.from('deals').select('id').eq('id', dealId).eq('organization_id', orgId).is('deleted_at', null).maybeSingle();
  if (visibilityError) return json({ error: 'Falha ao consultar lead' }, 500);
  if (!visible) return json({ error: 'Lead não encontrado' }, 404);
  function sourceQuery(table: 'activities' | 'deal_events' | 'deal_notes', source: TimelineCursor['source']) {
    let query = supabase.from(table).select('*').eq('deal_id', dealId).eq('organization_id', orgId);
    if (table === 'activities') query = query.is('deleted_at', null);
    if (cursor) query = query.or(cursorFilter(cursor, source));
    return query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(51).abortSignal(req.signal);
  }
  const [actRes, evRes, notesRes, sinceRes] = await Promise.all([
    sourceQuery('activities', 'activity'), sourceQuery('deal_events', 'event'), sourceQuery('deal_notes', 'note'),
    supabase.from('deal_events').select('created_at').eq('organization_id', orgId).order('created_at', { ascending: true }).limit(1).abortSignal(req.signal).maybeSingle(),
  ]);
  if ([actRes, evRes, notesRes, sinceRes].some(r => r.error)) return json({ error: 'Falha ao carregar o histórico' }, 500);
  const page = paginateTimeline([
    ...(actRes.data ?? []).map(row => ({ id: row.id as string, at: row.created_at as string, source: 'activity' as const })),
    ...(evRes.data ?? []).map(row => ({ id: row.id as string, at: row.created_at as string, source: 'event' as const })),
    ...(notesRes.data ?? []).map(row => ({ id: row.id as string, at: row.created_at as string, source: 'note' as const })),
  ], cursor);
  const selected = new Set(page.items.map(row => `${row.source}:${row.id}`));
  const acts = (actRes.data as ActivityRow[]).filter(row => selected.has(`activity:${row.id}`));
  const events = (evRes.data as EventRow[]).filter(row => selected.has(`event:${row.id}`)).reverse();
  const apiNotes = (notesRes.data as NoteRow[]).filter(row => selected.has(`note:${row.id}`));
  const admin = auth.admin;
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
    if (a.assigned_to) userIds.add(a.assigned_to);
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


  return json({
    activities: acts.map(a => ({ id: a.id, organizationId: a.organization_id, title: a.title, description: a.description ?? undefined, type: a.type, date: a.date, completed: a.completed, dealId: a.deal_id, dealTitle: '', contactId: a.contact_id ?? undefined, assignedTo: a.assigned_to, assignedToName: a.assigned_to ? names.get(a.assigned_to) ?? null : null, user: { name: a.created_by ? names.get(a.created_by) ?? '' : '', avatar: '' } })),
    nextCursor: page.nextCursor,
    history: {
      available: true, since: sinceRes.data?.created_at ?? null,
      events: events.map(e => ({ ...e, actor_name: e.actor_id ? names.get(e.actor_id) ?? null : null })),
      activityMeta: Object.fromEntries(acts.map(a => [a.id, { createdAt: a.created_at, authorKind: a.created_actor_kind, authorName: a.created_by ? names.get(a.created_by) ?? null : null, editedAt: a.edited_at, editedByName: a.edited_by ? names.get(a.edited_by) ?? null : null }])),
      apiNotes: apiNotes.map(n => ({ id: n.id, content: n.content, createdAt: n.created_at, updatedAt: n.updated_at, authorName: n.created_by ? names.get(n.created_by) ?? null : null })),
    },
  });
}
