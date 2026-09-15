import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { getConnectionByIdForOrg } from '@/lib/whatsapp/service';
import { getProvider } from '@/lib/whatsapp';
import { messageEditError, type EditableMessage } from '@/lib/whatsapp/messageEditing';
import { z } from 'zod';

const inputSchema = z.object({ messageId: z.string().uuid(), text: z.string().trim().min(1).max(4096) });

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const input = inputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ error: 'Informe a mensagem e um texto de até 4096 caracteres.' }, 400);
  const { admin, user } = auth;
  const { data: message, error } = await admin.from('wa_messages')
    .select('id,conversation_id,direction,sent_by,status,body,media_type,evolution_message_id,wa_timestamp,created_at')
    .eq('id', input.data.messageId).eq('organization_id', user.organizationId).maybeSingle();
  if (error) return json({ error: 'Não foi possível consultar a mensagem.' }, 500);
  if (!message || !(await conversationAllowed(admin, user, { id: message.conversation_id }))) return json({ error: 'Mensagem indisponível.' }, 404);
  const { data: conv } = await admin.from('wa_conversations')
    .select('id,connection_id,wa_phone,is_group,group_jid,last_message_at')
    .eq('id', message.conversation_id).eq('organization_id', user.organizationId).maybeSingle();
  const conn = conv?.connection_id ? await getConnectionByIdForOrg(admin, user.organizationId, conv.connection_id) : null;
  if (!conn || conn.status !== 'connected') return json({ error: 'O número desta mensagem está desconectado.' }, 409);
  const reason = messageEditError(message as EditableMessage, user.id, conn.provider);
  if (reason) return json({ error: reason }, 403);
  const provider = getProvider(conn);
  if (!provider.editText) return json({ error: 'Esta conexão não permite editar mensagens.' }, 409);
  if (message.body === input.data.text) return json({ ok: true, id: message.id, body: message.body });
  try {
    const result = await provider.editText({ to: conv!.is_group ? conv!.group_jid || conv!.wa_phone : conv!.wa_phone,
      providerMessageId: message.evolution_message_id!, text: input.data.text });
    if (!result.ok) return json({ error: result.error || 'O WhatsApp não aceitou a edição.' }, 502);
  } catch {
    return json({ error: 'Não foi possível confirmar a edição no WhatsApp. Atualize a conversa antes de tentar novamente.' }, 502);
  }
  const editedAt = new Date().toISOString();
  const { error: updateError } = await admin.from('wa_messages').update({ body: input.data.text, edited_at: editedAt })
    .eq('id', message.id).eq('organization_id', user.organizationId);
  if (updateError) return json({ error: 'Mensagem editada no WhatsApp, mas não foi possível atualizar o CRM. Atualize a conversa.' }, 500);
  // Only change the conversation preview if this is still its latest message.
  const { data: latest } = await admin.from('wa_messages').select('id').eq('conversation_id', conv!.id)
    .eq('organization_id', user.organizationId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (latest?.id === message.id && conv!.last_message_at) {
    await admin.from('wa_conversations').update({ last_message_preview: input.data.text.slice(0, 140) })
      .eq('id', conv!.id).eq('organization_id', user.organizationId).eq('last_message_at', conv!.last_message_at);
  }
  return json({ ok: true, id: message.id, body: input.data.text, edited_at: editedAt });
}
