/** GET /api/feedback/[id] — detalhe para o autor ou o super_admin, com links temporários dos anexos. */
import { json, requireOrgUser } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { FEEDBACK_BUCKET } from '@/lib/feedback/constants';
import { UserRole } from '@/types/constants';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'Pedido não encontrado.' }, 404);
  const { data: request } = await auth.admin.from('feedback_requests')
    .select('id, organization_id, author_id, kind, body, transcript, screen_path, device, status, priority_label, public_reply, tutorial_url, origin, created_at, updated_at')
    .eq('id', id).maybeSingle();
  const isSuper = auth.user.role === UserRole.SUPER_ADMIN;
  if (!request || (!isSuper && request.author_id !== auth.user.id)) return json({ error: 'Pedido não encontrado.' }, 404);
  const [atts, msgs] = await Promise.all([
    auth.admin.from('feedback_attachments').select('id, kind, mime, size_bytes, storage_path, created_at').eq('request_id', id).order('created_at'),
    auth.admin.from('feedback_messages').select('id, author_kind, body, created_at').eq('request_id', id).order('created_at'),
  ]);
  const attachments = await Promise.all((atts.data ?? []).map(async a => {
    const { data } = await auth.admin.storage.from(FEEDBACK_BUCKET).createSignedUrl(a.storage_path, 3600);
    return { id: a.id, kind: a.kind, mime: a.mime, size_bytes: a.size_bytes, url: data?.signedUrl ?? null };
  }));
  return json({ data: { ...request, attachments, messages: msgs.data ?? [] } });
}
