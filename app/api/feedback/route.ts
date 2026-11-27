/**
 * Caixa de ajustes.
 * POST cria um pedido (qualquer usuário logado). GET lista os pedidos da pessoa;
 * com ?scope=all, o super_admin vê todos, com escritório e autor.
 */
import { json, requireOrgUser } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { CreateFeedbackSchema } from '@/lib/feedback/schemas';
import { deviceFromUserAgent, ownsFeedbackPath } from '@/lib/feedback/paths';
import { FEEDBACK_LIMITS, FEEDBACK_STATUSES } from '@/lib/feedback/constants';
import { UserRole } from '@/types/constants';

export const runtime = 'nodejs';

const LIST_COLUMNS = 'id, organization_id, author_id, kind, body, transcript, status, priority_label, public_reply, tutorial_url, origin, created_at, updated_at';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const parsed = CreateFeedbackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'Pedido inválido.' }, 422);
  const input = parsed.data;
  const { id: userId, organizationId } = auth.user;
  if (input.attachments.some(a => !ownsFeedbackPath(organizationId, userId, a.path))) {
    return json({ error: 'Anexo inválido.' }, 422);
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await auth.admin.from('feedback_requests')
    .select('id', { count: 'exact', head: true }).eq('author_id', userId).gte('created_at', since);
  if (countError) return json({ error: 'Não foi possível registrar o pedido.' }, 500);
  if ((count ?? 0) >= FEEDBACK_LIMITS.perDay) {
    return json({ error: `Você já mandou ${FEEDBACK_LIMITS.perDay} pedidos nas últimas 24 horas. Tente mais tarde.` }, 429);
  }

  const userAgent = (req.headers.get('user-agent') || '').slice(0, 400) || null;
  const { data: created, error } = await auth.admin.from('feedback_requests').insert({
    organization_id: organizationId,
    author_id: userId,
    kind: input.kind ?? null,
    body: input.body.trim(),
    transcript: input.transcript?.trim() || null,
    screen_path: input.screenPath?.slice(0, 300) || null,
    device: deviceFromUserAgent(userAgent),
    user_agent: userAgent,
  }).select('id, status, created_at').single();
  if (error || !created) return json({ error: 'Não foi possível registrar o pedido.' }, 500);

  if (input.attachments.length) {
    const { error: attError } = await auth.admin.from('feedback_attachments').insert(input.attachments.map(a => ({
      request_id: created.id, organization_id: organizationId, kind: a.kind,
      storage_path: a.path, mime: a.mime.split(';')[0].trim(), size_bytes: a.size,
    })));
    if (attError) console.error('[feedback] anexos não registrados:', attError.message);
  }
  return json({ data: created }, 201);
}

export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const all = url.searchParams.get('scope') === 'all';
  if (!all) {
    const { data, error } = await auth.admin.from('feedback_requests').select(LIST_COLUMNS)
      .eq('author_id', auth.user.id).order('created_at', { ascending: false }).limit(100);
    return error ? json({ error: 'Não foi possível carregar os pedidos.' }, 500) : json({ data: data ?? [] });
  }
  if (auth.user.role !== UserRole.SUPER_ADMIN) return json({ error: 'Forbidden' }, 403);
  let query = auth.admin.from('feedback_requests').select(LIST_COLUMNS).order('created_at', { ascending: false }).limit(200);
  const status = url.searchParams.get('status');
  if (status && (FEEDBACK_STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
  const org = url.searchParams.get('organizationId');
  if (org && /^[0-9a-f-]{36}$/i.test(org)) query = query.eq('organization_id', org);
  const { data, error } = await query;
  if (error) return json({ error: 'Não foi possível carregar os pedidos.' }, 500);
  const rows = data ?? [];
  const orgIds = [...new Set(rows.map(r => r.organization_id))];
  const authorIds = [...new Set(rows.map(r => r.author_id).filter(Boolean))] as string[];
  const [orgs, authors] = await Promise.all([
    orgIds.length ? auth.admin.from('organizations').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] }),
    authorIds.length ? auth.admin.from('profiles').select('id, first_name, last_name, nickname').in('id', authorIds) : Promise.resolve({ data: [] }),
  ]);
  const orgName = new Map((orgs.data ?? []).map((o: { id: string; name: string }) => [o.id, o.name]));
  const authorName = new Map((authors.data ?? []).map((p: { id: string; first_name: string | null; last_name: string | null; nickname: string | null }) =>
    [p.id, p.nickname || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Usuário']));
  return json({ data: rows.map(r => ({ ...r, organization_name: orgName.get(r.organization_id) ?? null,
    author_name: r.author_id ? authorName.get(r.author_id) ?? 'Usuário' : 'Usuário' })) });
}
