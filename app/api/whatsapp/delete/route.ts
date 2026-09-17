import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { getConnectionByIdForOrg } from '@/lib/whatsapp/service';
import { getProvider } from '@/lib/whatsapp';
import { messageDeleteError } from '@/lib/whatsapp/messageDeletion';
import { z } from 'zod';

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const input = z.object({ messageId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ error: 'Informe uma mensagem válida.' }, 400);
  const { admin, user } = auth;
  const { data: message, error } = await admin.from('wa_messages')
    .select('id,conversation_id,direction,sent_by,status,body,deleted_at,evolution_message_id,wa_timestamp,created_at')
    .eq('id', input.data.messageId).eq('organization_id', user.organizationId).maybeSingle();
  if (error) return json({ error: 'Não foi possível consultar a mensagem.' }, 500);
  if (!message || !(await conversationAllowed(admin, user, { id: message.conversation_id }))) return json({ error: 'Mensagem indisponível.' }, 404);
  if (message.direction !== 'out' || message.sent_by !== user.id) return json({ error: 'Você só pode excluir suas próprias mensagens.' }, 403);
  if (message.deleted_at) return json({ ok: true, id: message.id, deleted_at: message.deleted_at });
  const { data: conv } = await admin.from('wa_conversations').select('id,connection_id,wa_phone,is_group,group_jid,last_message_at')
    .eq('id', message.conversation_id).eq('organization_id', user.organizationId).maybeSingle();
  const conn = conv?.connection_id ? await getConnectionByIdForOrg(admin, user.organizationId, conv.connection_id) : null;
  if (!conn || conn.status !== 'connected') return json({ error: 'O número desta mensagem está desconectado.' }, 409);
  const reason = messageDeleteError(message, user.id, conn.provider);
  if (reason) return json({ error: reason }, 403);
  const provider = getProvider(conn);
  if (!provider.deleteMessage) return json({ error: 'Esta conexão não permite excluir mensagens.' }, 409);
  try {
    const result = await provider.deleteMessage({ to: conv!.is_group ? conv!.group_jid || conv!.wa_phone : conv!.wa_phone, providerMessageId: message.evolution_message_id! });
    if (!result.ok) return json({ error: result.error || 'O WhatsApp não aceitou a exclusão.' }, 502);
  } catch {
    return json({ error: 'Não foi possível confirmar a exclusão no WhatsApp. Atualize a conversa antes de tentar novamente.' }, 502);
  }
  const deletedAt = new Date().toISOString();
  const { error: updateError } = await admin.from('wa_messages').update({ deleted_at: deletedAt })
    .eq('id', message.id).eq('organization_id', user.organizationId).is('deleted_at', null);
  if (updateError) return json({ error: 'Exclusão aceita pelo WhatsApp, mas não foi possível atualizar o CRM. Atualize a conversa.' }, 500);
  const { data: latest } = await admin.from('wa_messages').select('id').eq('conversation_id', conv!.id)
    .eq('organization_id', user.organizationId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (latest?.id === message.id && conv!.last_message_at) {
    await admin.from('wa_conversations').update({ last_message_preview: 'Mensagem excluída' })
      .eq('id', conv!.id).eq('organization_id', user.organizationId).eq('last_message_at', conv!.last_message_at);
  }
  return json({ ok: true, id: message.id, deleted_at: deletedAt });
}
