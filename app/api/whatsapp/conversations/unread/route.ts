import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';

export const runtime = 'nodejs';

/**
 * POST /api/whatsapp/conversations/unread  body: { phone }
 * Marca a conversa como NÃO LIDA (a bolinha volta na lista do Chats, igual
 * ao "Marcar como não lida" do WhatsApp). Marcador 100% interno do CRM —
 * nada é enviado ao WhatsApp da pessoa.
 * Só arma o marcador (1) quando o contador está zerado; se já existem não
 * lidas de verdade, a contagem real é preservada.
 */
export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as {
    phone?: string;
    connectionId?: string | null;
  } | null;
  const phone = normalizePhoneE164(body?.phone || '');
  if (!phone) return json({ error: 'phone é obrigatório' }, 400);

  const variants = brPhoneVariants(phone);
  let q = auth.admin
    .from('wa_conversations')
    .update({ unread_count: 1 })
    .eq('organization_id', auth.user.organizationId)
    .in('wa_phone', variants.length ? variants : [phone]);
  // Conversas separadas por número: marca só a do número da linha clicada.
  // 'none' = linha órfã (conexão excluída): só a conversa sem número.
  if (body?.connectionId === 'none') q = q.is('connection_id', null);
  else if (body?.connectionId) q = q.eq('connection_id', body.connectionId);
  const { error } = await q.or('unread_count.is.null,unread_count.eq.0');

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
