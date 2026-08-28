/**
 * POST /api/whatsapp/groups/create — cria um grupo pela Groups API da Meta.
 *
 * Body: { connectionId, subject, description? }
 * Só para número da API oficial (meta_cloud) conectado, com a chave "Grupos"
 * da org ligada. O grupo nasce com o número da empresa dentro; as pessoas
 * entram pelo link de convite (até 8 participantes, regra da Meta). Devolve a
 * conversa criada e o link.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByIdForOrg, getWaGroupsEnabled } from '@/lib/whatsapp/service';
import { isMetaCloudConnection } from '@/lib/whatsapp';
import { createMetaGroup, getMetaGroupInviteLink } from '@/lib/whatsapp/groups';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const body = (await req.json().catch(() => null)) as {
    connectionId?: string;
    subject?: string;
    description?: string;
  } | null;
  const connectionId = (body?.connectionId || '').trim();
  const subject = (body?.subject || '').trim();
  const description = (body?.description || '').trim();
  if (!connectionId) return json({ error: 'Escolha o número da API oficial.' }, 400);
  if (!subject) return json({ error: 'Dê um nome ao grupo.' }, 400);
  if (subject.length > 128) return json({ error: 'O nome do grupo tem no máximo 128 caracteres.' }, 400);
  if (description.length > 2048) return json({ error: 'A descrição tem no máximo 2048 caracteres.' }, 400);

  if (!(await getWaGroupsEnabled(auth.admin, orgId))) {
    return json({ error: 'Grupos do WhatsApp estão desligados nesta organização. Ligue na tela Conexão.' }, 403);
  }
  const conn = await getConnectionByIdForOrg(auth.admin, orgId, connectionId);
  if (!conn || conn.status !== 'connected') return json({ error: 'Número não encontrado ou desconectado.' }, 404);
  if (!isMetaCloudConnection(conn)) {
    return json({ error: 'Criar grupo pelo CRM só funciona com número da WhatsApp API oficial. Em número via QR Code, crie o grupo no celular.' }, 409);
  }

  const created = await createMetaGroup(conn, { subject, description: description || undefined });
  if (!created.ok) return json({ error: `A Meta não criou o grupo: ${created.error}` }, 502);

  // link de convite: best-effort (a conversa existe mesmo sem ele; dá pra gerar depois)
  const invite = await getMetaGroupInviteLink(conn, created.groupId);
  const inviteLink = invite.ok ? invite.inviteLink : null;

  const now = new Date().toISOString();
  const { data: conv, error } = await auth.admin
    .from('wa_conversations')
    .upsert(
      {
        organization_id: orgId,
        connection_id: conn.id,
        wa_phone: created.groupId,
        wa_name: subject,
        is_group: true,
        group_jid: created.groupId,
        participants_count: 1,
        group_invite_link: inviteLink,
        last_message_at: now,
        last_message_preview: 'Grupo criado pelo CRM',
      },
      { onConflict: 'organization_id,connection_id,wa_phone' }
    )
    .select('id')
    .single();
  if (error || !conv) return json({ error: error?.message || 'Grupo criado na Meta, mas não foi possível registrar no CRM.' }, 500);

  return json({
    ok: true,
    conversationId: (conv as { id: string }).id,
    groupId: created.groupId,
    inviteLink,
    ...(invite.ok ? {} : { inviteError: invite.error }),
  });
}
