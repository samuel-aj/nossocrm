import { parseMessageEdit, type MessageEdit } from './edits.ts';

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value && typeof value === 'object' ? value as Obj : {};
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encryptedEdit(item: unknown): Obj | null {
  const queue = [object(item)];
  for (let i = 0; queue.length && i < 24; i++) {
    const m = queue.shift()!;
    const encrypted = object(m.secretEncryptedMessage);
    if ([2, 'MESSAGE_EDIT'].includes(encrypted.secretEncType as number | string) && typeof object(encrypted.targetMessageKey).id === 'string') return encrypted;
    for (const key of ['message', 'update', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']) {
      if (m[key]) queue.push(object(m[key]));
    }
  }
  return null;
}

function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value === 'string') {
    if (value.length > 87384) throw new Error('Encrypted edit bytes exceed size limit');
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
  }
  if (value instanceof Uint8Array) {
    if (value.length > 65536) throw new Error('Encrypted edit bytes exceed size limit');
    return new Uint8Array(value);
  }
  const buffer = object(value);
  let values: unknown[];
  if (Array.isArray(value)) values = value;
  else if (Array.isArray(buffer.data)) values = buffer.data;
  else {
    // Evolution's live webhook JSON serializes Uint8Array as indexed objects;
    // chat/findMessages returns base64 for the same bytes stored by Prisma.
    const keys = Object.keys(buffer);
    if (!keys.length || keys.length > 65536 || !keys.every((key, index) => key === String(index))) throw new Error('Invalid encrypted edit bytes');
    values = keys.map(key => buffer[key]);
  }
  if (values.length > 65536 || !Array.from(values).every(v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error('Invalid encrypted edit bytes');
  return Uint8Array.from(values as number[]);
}
function jid(value: unknown): string {
  return typeof value === 'string' ? value.replace(/:\d+@/, '@').replace(/@c\.us$/, '@s.whatsapp.net') : '';
}
function senders(key: Obj): string[] {
  const group = String(key.remoteJid || '').endsWith('@g.us');
  return [...new Set((group ? [key.participant, key.participantAlt] : [key.remoteJid, key.remoteJidAlt]).map(jid).filter(Boolean))];
}

/** Bounded WAProto reader: only text-bearing fields of an authenticated edit.
 * Field numbers: WhiskeySockets/Baileys WAProto/WAProto.proto (Message, ProtocolMessage).
 * Unknown protobuf fields are skipped, not interpreted as text.
 */
function fields(data: Uint8Array): Map<number, Uint8Array | number> {
  if (data.length > 65536) throw new Error('Encrypted edit exceeds size limit');
  let at = 0;
  const readInt = () => {
    let n = 0;
    for (let i = 0; i < 10; i++) {
      if (at >= data.length) throw new Error('Truncated protobuf');
      const b = data[at++]; n += (b & 127) * 2 ** (i * 7);
      if (!(b & 128)) return n;
    }
    throw new Error('Invalid protobuf integer');
  };
  const result = new Map<number, Uint8Array | number>();
  while (at < data.length) {
    const tag = readInt(), field = Math.floor(tag / 8), wire = tag % 8;
    if (!field) throw new Error('Invalid protobuf tag');
    if (wire === 0) result.set(field, readInt());
    else if (wire === 2) {
      const length = readInt();
      if (!Number.isSafeInteger(length) || at + length > data.length) throw new Error('Truncated protobuf field');
      result.set(field, data.subarray(at, at + length)); at += length;
    } else if (wire === 1 || wire === 5) {
      at += wire === 1 ? 8 : 4;
      if (at > data.length) throw new Error('Truncated protobuf fixed field');
    } else throw new Error('Unsupported protobuf wire type');
  }
  return result;
}
function textMessage(data: Uint8Array): Obj {
  const m = fields(data), plain = m.get(1), extended = m.get(6);
  if (plain instanceof Uint8Array) return { conversation: decoder.decode(plain) };
  if (extended instanceof Uint8Array) {
    const text = fields(extended).get(1);
    if (text instanceof Uint8Array) return { extendedTextMessage: { text: decoder.decode(text) } };
  }
  throw new Error('Unsupported encrypted edit content');
}
function decodedEdit(data: Uint8Array, targetId: string, editedAt: string): MessageEdit {
  const root = fields(data), protocol = root.get(12);
  let content: Obj;
  if (protocol instanceof Uint8Array) {
    const p = fields(protocol), key = p.get(1), edited = p.get(14);
    const id = key instanceof Uint8Array ? fields(key).get(3) : null;
    if (!(id instanceof Uint8Array) || decoder.decode(id) !== targetId || p.get(2) !== 14 || !(edited instanceof Uint8Array)) throw new Error('Encrypted edit target mismatch');
    content = { key: { id: targetId }, editedMessage: textMessage(edited), timestampMs: p.get(15) };
  } else content = { key: { id: targetId }, editedMessage: textMessage(data) };
  const edit = parseMessageEdit('messages.edited', content, editedAt);
  if (!edit || edit.text.length > 16384) throw new Error('Invalid encrypted edit text');
  return edit;
}

/** Incoming target keys use the sender's perspective. Use the original stored
 * provider key for identity, not targetMessageKey.fromMe/remoteJid.
 * HKDF/AES-GCM layout follows Baileys reporting-utils and PR #2554.
 */
export async function decryptIncomingEdit(item: unknown, originalValue: unknown): Promise<MessageEdit> {
  const root = object(item), original = object(originalValue);
  const secretEdit = encryptedEdit(root), originalKey = object(original.key), editKey = object(root.key);
  const targetId = String(object(secretEdit?.targetMessageKey).id || '');
  if (!secretEdit || editKey.fromMe !== false || originalKey.fromMe !== false || originalKey.id !== targetId) throw new Error('Invalid incoming edit identity');
  const chatIds = [editKey.remoteJid, editKey.remoteJidAlt].map(jid).filter(Boolean);
  if (![originalKey.remoteJid, originalKey.remoteJidAlt].map(jid).some(id => id && chatIds.includes(id))) throw new Error('Encrypted edit conversation mismatch');
  const authors = senders(originalKey), editors = senders(editKey);
  if (!authors.some(author => editors.includes(author))) throw new Error('Encrypted edit sender mismatch');
  const secret = bytes(object(object(original.message).messageContextInfo).messageSecret);
  const iv = bytes(secretEdit.encIv), payload = bytes(secretEdit.encPayload);
  if (secret.length !== 32 || iv.length !== 12 || payload.length < 17 || payload.length > 65536) throw new Error('Invalid encrypted edit sizes');
  const keyMaterial = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  let plain: ArrayBuffer | undefined;
  // Evolution 2.3.7 replaces remoteJid with remoteJidAlt before delivering
  // the webhook, losing the LID on the wire. The original provider record
  // retains the authenticated sender's PN/LID pair. After matching sender
  // aliases above, try that pair for both identities in this self-edit.
  for (const author of authors) {
      const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0),
        info: encoder.encode(targetId + author + author + 'Message Edit') }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, payload); break; }
      catch { /* Try the alternate PN/LID identity; never accept unauthenticated text. */ }
  }
  if (!plain) throw new Error('Encrypted edit authentication failed');
  const rawTime = root.messageTimestamp;
  const t = typeof rawTime === 'object' ? Number(object(rawTime).low) >>> 0 : Number(rawTime);
  if (!Number.isFinite(t) || t <= 0) throw new Error('Encrypted edit timestamp missing');
  return decodedEdit(new Uint8Array(plain), targetId, new Date(t * 1000).toISOString());
}

export interface EditConnection { id: string; base_url?: string | null; instance_token?: string | null; instance_name: string; }
// deno-lint-ignore no-explicit-any
export async function resolveEncryptedEdit(db: any, organizationId: string, connection: EditConnection, item: unknown): Promise<MessageEdit | null> {
  const encrypted = encryptedEdit(item);
  if (!encrypted || object(object(item).key).fromMe !== false) return null;
  const targetId = String(object(encrypted.targetMessageKey).id);
  const { data: target, error } = await db.from('wa_messages').select('id,deleted_at,direction,wa_conversations!inner(connection_id)')
    .eq('organization_id', organizationId).eq('evolution_message_id', targetId)
    .eq('wa_conversations.connection_id', connection.id).maybeSingle();
  if (error || !target) throw new Error('Encrypted edit original not yet stored');
  if (target.deleted_at || target.direction !== 'in') return null;
  const base = (connection.base_url || '').replace(/\/+$/, '').replace(/\/manager$/, '');
  if (!base || !connection.instance_token) throw new Error('Encrypted edit provider unavailable');
  let response: Response;
  try {
    response = await fetch(`${base}/chat/findMessages/${encodeURIComponent(connection.instance_name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: connection.instance_token },
      body: JSON.stringify({ where: { key: { id: targetId } }, page: 1, offset: 1 }), signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error('Encrypted edit original lookup failed'); }
  if (!response.ok) throw new Error('Encrypted edit provider lookup rejected');
  const body = object(await response.json());
  const records = object(body.messages).records;
  const original = Array.isArray(records) ? records.find(row => object(object(row).key).id === targetId) : null;
  if (!original) throw new Error('Encrypted edit original unavailable');
  return decryptIncomingEdit(item, original);
}
