import { requireOrgUser, json } from './api';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { getConnectionByIdForOrg, getGroupConversation, getWaGroupsEnabled } from './service';
import { isValidUUID } from '@/lib/supabase/utils';

export async function getAccessibleGroup(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const id = new URL(req.url).searchParams.get('conversationId') || '';
  if (!isValidUUID(id)) return json({ error: 'Grupo inválido.' }, 400);
  const orgId = auth.user.organizationId;
  if (!(await getWaGroupsEnabled(auth.admin, orgId))) return json({ error: 'Grupos estão desativados.' }, 403);
  if (!(await conversationAllowed(auth.admin, auth.user, { id }))) return json({ error: 'Grupo indisponível.' }, 404);
  const group = await getGroupConversation(auth.admin, orgId, id);
  if (!group) return json({ error: 'Grupo indisponível.' }, 404);
  const conn = group.connection_id ? await getConnectionByIdForOrg(auth.admin, orgId, group.connection_id) : null;
  if (conn?.status !== 'connected') return json({ error: 'O número deste grupo está desconectado.' }, 409);
  return { admin: auth.admin, group, conn, orgId, groupId: group.group_jid || group.wa_phone };
}
