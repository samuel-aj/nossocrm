import { requireOrgUser, json } from '@/lib/whatsapp/api';

export const runtime = 'nodejs';

/**
 * GET /api/whatsapp/conversations
 * Lista as conversas de WhatsApp da organização (inbox da página Chats),
 * ordenadas da mais recente para a mais antiga. Mesmo padrão das demais
 * rotas wa_*: sessão autentica, service role lê filtrando por organization_id.
 */
export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from('wa_conversations')
    .select('id, wa_phone, wa_name, contact_id, deal_id, last_message_at, last_message_preview, unread_count')
    .eq('organization_id', auth.user.organizationId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) return json({ error: error.message }, 500);
  return json({ data: data || [] });
}
