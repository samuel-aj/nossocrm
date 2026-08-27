import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg, getWaGroupsEnabled } from '@/lib/whatsapp/service';

export const runtime = 'nodejs';

/**
 * GET /api/whatsapp/conversations[?connectionId=...]
 * Lista as conversas de WhatsApp da organização (inbox da página Chats),
 * ordenadas da mais recente para a mais antiga. Mesmo padrão das demais
 * rotas wa_*: sessão autentica, service role lê filtrando por organization_id.
 *
 * connectionId restringe às conversas de UM número conectado (org com mais de
 * um número). O escopo por organization_id já impede id de outra org: com um
 * connectionId alheio a interseção é vazia, não há vazamento.
 *
 * GRUPOS: só entram na lista quando a org ligou "Grupos do WhatsApp no chat"
 * (`groupsEnabled` na resposta); desligada, as conversas de grupo ficam
 * guardadas mas escondidas.
 *
 * WhatsApp DESCONECTADO => lista vazia: as conversas ficam guardadas mas não
 * aparecem (reconectar o MESMO número traz de volta; número diferente apaga
 * — ver connection.update na edge function whatsapp-webhook).
 */
export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn || conn.status !== 'connected') {
    return json({ data: [], groupsEnabled: false });
  }

  const connectionId = new URL(req.url).searchParams.get('connectionId');
  const groupsEnabled = await getWaGroupsEnabled(auth.admin, auth.user.organizationId);

  let q = auth.admin
    .from('wa_conversations')
    .select(
      'id, connection_id, wa_phone, wa_name, contact_id, deal_id, last_message_at, last_message_preview, unread_count, is_group, group_jid, participants_count'
    )
    .eq('organization_id', auth.user.organizationId);
  if (connectionId) q = q.eq('connection_id', connectionId);
  if (!groupsEnabled) q = q.eq('is_group', false);
  const { data, error } = await q
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) return json({ error: error.message }, 500);
  return json({ data: data || [], groupsEnabled });
}
