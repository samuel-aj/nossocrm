type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v && typeof v === 'object' ? v as Obj : {};
export interface MessageDeletion { targetId: string; deletedAt: string; }
/** Only explicit remote revocations, never chat clears or ordinary ACKs. */
export function parseMessageDeletion(event: string, item: unknown, now = new Date().toISOString()): MessageDeletion | null {
  const root = object(item);
  if (event === 'messages.delete' && root.status === 'DELETED') {
    const id = object(root.key).id ?? root.id;
    if (typeof id === 'string' && id) return { targetId: id, deletedAt: now };
  }
  const queue = [root];
  for (let i = 0; queue.length && i < 32; i++) {
    const value = queue.shift()!;
    const protocol = object(value.protocolMessage);
    if ((protocol.type === 0 || protocol.type === 'REVOKE') && typeof object(protocol.key).id === 'string') {
      return { targetId: String(object(protocol.key).id), deletedAt: now };
    }
    for (const key of ['message', 'update', 'ephemeralMessage', 'viewOnceMessage', 'deviceSentMessage']) {
      if (value[key] && typeof value[key] === 'object') queue.push(object(value[key]));
    }
  }
  return null;
}
// deno-lint-ignore no-explicit-any
export async function applyMessageDeletion(db: any, organizationId: string, connectionId: string, deletion: MessageDeletion): Promise<void> {
  const find = () => db.from('wa_messages').select('id,deleted_at,conversation_id,wa_conversations!inner(connection_id)')
    .eq('organization_id', organizationId).eq('evolution_message_id', deletion.targetId)
    .eq('wa_conversations.connection_id', connectionId).maybeSingle();
  let result = await find();
  if (!result.error && !result.data) { await new Promise(resolve => setTimeout(resolve, 1500)); result = await find(); }
  if (result.error || !result.data) throw new Error('Original message for deletion not found');
  const message = result.data;
  const { error } = await db.from('wa_messages').update({ deleted_at: deletion.deletedAt })
    .eq('id', message.id).eq('organization_id', organizationId).is('deleted_at', null);
  if (error) throw new Error('Failed to persist message deletion');
  const { data: conv } = await db.from('wa_conversations').select('last_message_at')
    .eq('id', message.conversation_id).eq('connection_id', connectionId).eq('organization_id', organizationId).maybeSingle();
  const { data: latest } = await db.from('wa_messages').select('id').eq('conversation_id', message.conversation_id)
    .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (latest?.id === message.id && conv?.last_message_at) {
    const { error: previewError } = await db.from('wa_conversations').update({ last_message_preview: 'Mensagem excluída' })
      .eq('id', message.conversation_id).eq('organization_id', organizationId).eq('last_message_at', conv.last_message_at);
    if (previewError) throw new Error('Failed to update deletion preview');
  }
}
