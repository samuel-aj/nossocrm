import { json } from '@/lib/whatsapp/api';
import { getAccessibleGroup } from '@/lib/whatsapp/groupAccess';
import { getGroupParticipants, getMetaGroupParticipants } from '@/lib/whatsapp/groups';
import { withGroupSenderNames } from '@/lib/whatsapp/groupMemberNames';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const access = await getAccessibleGroup(req);
  if (access instanceof Response) return access;
  const { group, conn, groupId, admin, orgId } = access;
  const meta = conn.provider === 'meta_cloud';
  const result = meta ? await getMetaGroupParticipants(conn, groupId) : await getGroupParticipants(conn, groupId);
  if (!result.ok) return json({ error: result.error, unsupported: !!('unsupported' in result && result.unsupported) }, 'unsupported' in result ? 422 : 502);
  const participants = await withGroupSenderNames(admin, orgId, group.id, result.participants);
  return json({ participants, connectionId: conn.id, mentionsSupported: !meta });
}
