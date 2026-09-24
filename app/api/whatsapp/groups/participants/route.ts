import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { getConnectionByIdForOrg, getGroupConversation, getWaGroupsEnabled } from '@/lib/whatsapp/service';
import { getGroupParticipants } from '@/lib/whatsapp/groups';
import { isValidUUID } from '@/lib/supabase/utils';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const id = new URL(req.url).searchParams.get('conversationId') || '';
  if (!isValidUUID(id)) return json({ error: 'Grupo inválido' }, 400);
  if (!(await getWaGroupsEnabled(auth.admin, auth.user.organizationId))) return json({ error: 'Grupos estão desativados.' }, 403);
  if (!(await conversationAllowed(auth.admin, auth.user, { id }))) return json({ error: 'Grupo indisponível' }, 404);
  const group = await getGroupConversation(auth.admin, auth.user.organizationId, id);
  if (!group) return json({ error: 'Grupo indisponível' }, 404);
  const conn = group.connection_id ? await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, group.connection_id) : null;
  if (!conn || conn.status !== 'connected') return json({ error: 'O número deste grupo está desconectado.' }, 409);
  const result = await getGroupParticipants(conn, group.group_jid || group.wa_phone);
  if (!result.ok) return json({ error: result.error, unsupported: !!('unsupported' in result && result.unsupported) }, 'unsupported' in result ? 422 : 502);
  return json({ participants: result.participants, connectionId: conn.id });
}
