/**
 * POST /api/whatsapp/groups/invite — link de convite de um grupo.
 *
 * Body: { conversationId, reset?: boolean }
 * Meta (Groups API): GET/POST /{group_id}/invite_link. Evolution (QR Code):
 * /group/inviteCode (reset = revokeInviteCode antes). Guarda o link na
 * conversa e devolve. reset = gera um link novo e invalida o antigo.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByIdForOrg, getGroupConversation, getWaGroupsEnabled } from '@/lib/whatsapp/service';
import { isMetaCloudConnection } from '@/lib/whatsapp';
import { getEvolutionGroupInviteLink, getMetaGroupInviteLink } from '@/lib/whatsapp/groups';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const body = (await req.json().catch(() => null)) as { conversationId?: string; reset?: boolean } | null;
  const conversationId = (body?.conversationId || '').trim();
  const reset = body?.reset === true;
  if (!conversationId) return json({ error: 'conversationId é obrigatório' }, 400);

  if (!(await getWaGroupsEnabled(auth.admin, orgId))) {
    return json({ error: 'Grupos do WhatsApp estão desligados nesta organização.' }, 403);
  }
  const group = await getGroupConversation(auth.admin, orgId, conversationId);
  if (!group) return json({ error: 'Grupo não encontrado.' }, 404);

  // link já guardado e sem pedido de novo: devolve direto
  if (!reset && group.group_invite_link) return json({ ok: true, inviteLink: group.group_invite_link });

  const conn = group.connection_id ? await getConnectionByIdForOrg(auth.admin, orgId, group.connection_id) : null;
  if (!conn || conn.status !== 'connected') return json({ error: 'O número deste grupo está desconectado.' }, 409);

  const groupId = group.group_jid || group.wa_phone;
  const r = isMetaCloudConnection(conn)
    ? await getMetaGroupInviteLink(conn, groupId, reset)
    : await getEvolutionGroupInviteLink(conn, groupId, reset);
  if (!r.ok) return json({ error: `Não deu para obter o link de convite: ${r.error}` }, 502);

  await auth.admin
    .from('wa_conversations')
    .update({ group_invite_link: r.inviteLink })
    .eq('id', group.id)
    .eq('organization_id', orgId);

  return json({ ok: true, inviteLink: r.inviteLink });
}
