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
    .select('id, author_id, organization_id').eq('id', id).maybeSingle();
  if (!request || request.author_id !== auth.user.id) return json({ error: 'Pedido não encontrado.' }, 404);

  // Só volta para a fila se ainda estiver esperando resposta: duas respostas ao mesmo tempo,
  // ou a esteira mudando o status no meio, não passam daqui.
  const { data: reopened, error: updError } = await auth.admin.from('feedback_requests').update({ status: 'recebido' })
    .eq('id', id).eq('author_id', auth.user.id).eq('status', 'precisa_detalhes').select('id');
  if (updError) return json({ error: 'Não foi possível enviar a resposta.' }, 500);
  if (!reopened?.length) return json({ error: 'Este pedido não está esperando resposta.' }, 409);

  const { error } = await auth.admin.from('feedback_messages').insert({
    request_id: id, organization_id: request.organization_id, author_kind: 'user', author_id: auth.user.id, body: parsed.data.body,
  });
  if (error) {
    // Melhor esforço: devolve o pedido para "precisa de detalhes" para a pessoa tentar de novo.
    try {
      await auth.admin.from('feedback_requests').update({ status: 'precisa_detalhes' }).eq('id', id).eq('status', 'recebido');
    } catch { /* o 500 abaixo já avisa a pessoa */ }
    return json({ error: 'Não foi possível enviar a resposta.' }, 500);
  }
  return json({ ok: true }, 201);
}
