import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';
import { getConnectionByOrg } from '@/lib/whatsapp/service';
import { listVisibleConversations } from '@/lib/whatsapp/visibleConversations';

export const runtime = 'nodejs';

/**
 * GET /api/whatsapp/conversations/unread
 * Total de mensagens não lidas que o usuário enxerga (bolinha do item Chats no
 * menu). Roda em TODA tela do CRM, então é leve de propósito: só as conversas
 * com não lidas e só as colunas do filtro. Antes o menu buscava a lista
 * inteira de conversas e assinava todas as fotos a cada 30s.
 */
export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn || conn.status !== 'connected') return json({ total: 0 });

  const { data, error } = await listVisibleConversations(auth.admin, auth.user, {
    colunas: 'contact_id, unread_count',
    somenteNaoLidas: true,
  });
  if (error) return json({ error: error.message }, 500);

  const total = data.reduce((soma, c) => soma + (Number(c.unread_count) || 0), 0);
  return json({ total });
}

/**
 * POST /api/whatsapp/conversations/unread  body: { phone } | { conversationId }
 * Marca a conversa como NÃO LIDA (a bolinha volta na lista do Chats, igual
 * ao "Marcar como não lida" do WhatsApp). Marcador 100% interno do CRM —
 * nada é enviado ao WhatsApp da pessoa.
 * Só arma o marcador (1) quando o contador está zerado; se já existem não
 * lidas de verdade, a contagem real é preservada.
 * conversationId: grupos (não têm telefone) e qualquer conversa pelo id.
 */
export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as {
    phone?: string;
    connectionId?: string | null;
    conversationId?: string | null;
  } | null;

  const conversationId = (body?.conversationId || '').trim();
  if (conversationId) {
    if (!(await conversationAllowed(auth.admin, auth.user, { id: conversationId }))) return json({ error: 'Conversa indisponível' }, 404);
    const { error } = await auth.admin
      .from('wa_conversations')
      .update({ unread_count: 1 })
      .eq('organization_id', auth.user.organizationId)
      .eq('id', conversationId)
      .or('unread_count.is.null,unread_count.eq.0');
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  const phone = normalizePhoneE164(body?.phone || '');
  if (!phone) return json({ error: 'phone ou conversationId é obrigatório' }, 400);

  // The unified action is limited to the same authorized rows as the inbox.
  // Authorizing one matching conversation does not authorize all its numbers.
  const { data: visible, error: visibilityError } = await listVisibleConversations(auth.admin, auth.user, {
    colunas: 'id,contact_id,wa_phone,connection_id',
    connectionId: body?.connectionId && body.connectionId !== 'none' ? body.connectionId : null,
  });
  if (visibilityError) return json({ error: visibilityError.message }, 500);
  const variants = new Set(brPhoneVariants(phone).length ? brPhoneVariants(phone) : [phone]);
  const ids = visible.filter(c => variants.has(String(c.wa_phone)) && (body?.connectionId !== 'none' || !c.connection_id)).map(c => String(c.id));
  if (!ids.length) return json({ error: 'Conversa indisponível' }, 404);
  const { error } = await auth.admin.from('wa_conversations').update({ unread_count: 1 })
    .eq('organization_id', auth.user.organizationId).in('id', ids)
    .or('unread_count.is.null,unread_count.eq.0');
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
