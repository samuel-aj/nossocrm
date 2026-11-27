/** POST /api/feedback/[id]/messages { body } — a pessoa responde quando o pedido precisa de detalhes. */
import { json, requireOrgUser } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isValidUUID } from '@/lib/supabase/utils';
import { ReplySchema } from '@/lib/feedback/schemas';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'Pedido não encontrado.' }, 404);
  const parsed = ReplySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Escreva a resposta.' }, 422);
  const { data: request } = await auth.admin.from('feedback_requests')
    .select('id, author_id, organization_id, status').eq('id', id).maybeSingle();
  if (!request || request.author_id !== auth.user.id) return json({ error: 'Pedido não encontrado.' }, 404);
  if (request.status !== 'precisa_detalhes') return json({ error: 'Este pedido não está esperando resposta.' }, 409);
  const { error } = await auth.admin.from('feedback_messages').insert({
    request_id: id, organization_id: request.organization_id, author_kind: 'user', author_id: auth.user.id, body: parsed.data.body,
  });
  if (error) return json({ error: 'Não foi possível enviar a resposta.' }, 500);
  const { error: updError } = await auth.admin.from('feedback_requests').update({ status: 'recebido' }).eq('id', id);
  if (updError) return json({ error: 'Resposta gravada, mas o pedido não voltou para a fila.' }, 500);
  return json({ ok: true }, 201);
}
