/** Pure normalization: Evolution/Baileys edit envelopes vary by event/version. */
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' ? value as ObjectValue : {};
function contentText(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 8) return null;
  const m = object(value);
  if (typeof m.conversation === 'string') return m.conversation;
  if (typeof m.text === 'string') return m.text;
  for (const key of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage']) {
    const inner = object(m[key]);
    if (typeof inner.text === 'string') return inner.text;
    if (typeof inner.caption === 'string') return inner.caption;
  }
  for (const key of ['message', 'editedMessage', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'deviceSentMessage']) {
    const text = contentText(m[key], depth + 1);
    if (text !== null) return text;
  }
  return null;
}
function timestamp(value: unknown, milliseconds = false): string | null {
  const long = object(value);
  const n = typeof long.low === 'number' ? (Number(long.high || 0) * 4294967296 + (long.low >>> 0)) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = milliseconds || n > 1e12 ? n : n * 1000;
  return Number.isFinite(new Date(ms).getTime()) ? new Date(ms).toISOString() : null;
}
export interface MessageEdit { targetId: string; text: string; editedAt: string; }
export function parseMessageEdit(event: string, item: unknown, now = new Date().toISOString()): MessageEdit | null {
  const root = object(item);
  const queue: ObjectValue[] = [root];
  for (let depth = 0; queue.length && depth < 32; depth++) {
    const m = queue.shift()!;
    if (m.editedMessage && object(m.key).id) {
      const text = contentText(m.editedMessage);
      if (text?.trim()) return { targetId: String(object(m.key).id), text,
        editedAt: timestamp(m.timestampMs, true) || timestamp(root.messageTimestamp) || now };
    }
    for (const key of ['protocolMessage', 'message', 'update', 'editedMessage', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'deviceSentMessage']) {
      if (m[key] && typeof m[key] === 'object') queue.push(object(m[key]));
    }
  }
  // Plain text payloads are edits only when the event explicitly says so.
  if (!['messages.edited', 'send.message.update'].includes(event)) return null;
  const id = object(root.key).id ?? root.keyId ?? root.id;
  const text = contentText(root);
  return id && text?.trim() ? { targetId: String(id), text,
    editedAt: timestamp(root.timestampMs, true) || timestamp(root.messageTimestamp) || now } : null;
}

// deno-lint-ignore no-explicit-any
export async function applyMessageEdit(db: any, organizationId: string, connectionId: string, edit: MessageEdit): Promise<void> {
  const find = () => db.from('wa_messages')
    .select('id, body, edited_at, deleted_at, conversation_id, sender_name, wa_conversations!inner(connection_id)')
    .eq('organization_id', organizationId).eq('evolution_message_id', edit.targetId)
    .eq('wa_conversations.connection_id', connectionId).maybeSingle();
  let found = await find();
  if (found.error) throw new Error('Failed to find edited message');
  if (!found.data) { await new Promise(resolve => setTimeout(resolve, 1500)); found = await find(); }
  if (found.error || !found.data) throw new Error('Original message for edit not found');
  const message = found.data;
  if (message.deleted_at) return;
  if (message.body === edit.text || (message.edited_at && Date.parse(message.edited_at) > Date.parse(edit.editedAt))) return;
  // Compare-and-set prevents an older concurrent handler from undoing a newer edit.
  let update = db.from('wa_messages').update({ body: edit.text, edited_at: edit.editedAt })
    .eq('id', message.id).eq('organization_id', organizationId).is('deleted_at', null);
  update = message.edited_at ? update.eq('edited_at', message.edited_at) : update.is('edited_at', null);
  const result = await update.select('id');
  if (result.error) throw new Error('Failed to persist message edit');
  if (!result.data?.length) throw new Error('Concurrent edit: retry delivery');
  const { data: conv } = await db.from('wa_conversations').select('last_message_at')
    .eq('id', message.conversation_id).eq('connection_id', connectionId).eq('organization_id', organizationId).maybeSingle();
  const { data: latest } = await db.from('wa_messages').select('id').eq('conversation_id', message.conversation_id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (latest?.id === message.id && conv?.last_message_at) {
    const name = (message.sender_name || '').trim();
    await db.from('wa_conversations').update({ last_message_preview: `${name ? `${name}: ` : ''}${edit.text}`.slice(0, 140) })
      .eq('id', message.conversation_id).eq('connection_id', connectionId).eq('organization_id', organizationId)
      .eq('last_message_at', conv.last_message_at);
  }
}
