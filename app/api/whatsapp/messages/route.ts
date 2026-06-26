/**
 * GET /api/whatsapp/messages?phone=<telefone>
 * Retorna a conversa de WhatsApp daquele telefone (na org) + as mensagens.
 * Usado pelo chat dentro do card do lead.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg } from '@/lib/whatsapp/service';
import { normalizePhoneE164 } from '@/lib/phone';

export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const phone = normalizePhoneE164(new URL(req.url).searchParams.get('phone') || '');
  if (!phone) return json({ error: 'phone é obrigatório' }, 400);

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);

  const { data: conv } = await auth.admin
    .from('wa_conversations')
    .select('id, wa_phone, wa_name, contact_id, last_message_at, unread_count')
    .eq('organization_id', auth.user.organizationId)
    .eq('wa_phone', phone)
    .maybeSingle();

  let messages: unknown[] = [];
  if (conv) {
    const { data } = await auth.admin
      .from('wa_messages')
      .select(
        'id, direction, status, body, media_type, media_url, from_phone, to_phone, wa_timestamp, created_at, sent_by'
      )
      .eq('conversation_id', (conv as { id: string }).id)
      .order('created_at', { ascending: true })
      .limit(300);
    messages = data || [];
  }

  return json({
    connected: conn?.status === 'connected',
    hasConnection: !!conn,
    conversation: conv ?? null,
    messages,
  });
}
