/**
 * GET /api/whatsapp/messages?phone=<telefone>
 * Retorna a conversa de WhatsApp daquele telefone (na org) + as mensagens.
 * Usado pelo chat dentro do card do lead.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg } from '@/lib/whatsapp/service';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';

export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const phone = normalizePhoneE164(new URL(req.url).searchParams.get('phone') || '');
  if (!phone) return json({ error: 'phone é obrigatório' }, 400);

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);

  // Variantes BR do nono dígito: o JID do WhatsApp pode vir sem o 9 do
  // celular, criando conversa em outra grafia do MESMO número. Busca as duas
  // e junta as mensagens.
  const variants = brPhoneVariants(phone);
  const { data: convList } = await auth.admin
    .from('wa_conversations')
    .select('id, wa_phone, wa_name, contact_id, last_message_at, unread_count')
    .eq('organization_id', auth.user.organizationId)
    .in('wa_phone', variants.length ? variants : [phone]);

  const convs = (convList ?? []) as Array<{ id: string; contact_id: string | null }>;
  const conv = convs.find(c => c.contact_id) ?? convs[0] ?? null;

  let messages: unknown[] = [];
  if (convs.length > 0) {
    const { data } = await auth.admin
      .from('wa_messages')
      .select(
        'id, direction, status, body, media_type, media_url, from_phone, to_phone, wa_timestamp, created_at, sent_by'
      )
      .in('conversation_id', convs.map(c => c.id))
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
