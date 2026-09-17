import { createCipheriv, hkdfSync, webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { decryptIncomingEdit, encryptedEdit, resolveEncryptedEdit } from './encrypted-edits';
vi.stubGlobal('crypto', webcrypto);
afterEach(() => vi.unstubAllGlobals());
const secret = Buffer.alloc(32, 7), iv = Buffer.alloc(12, 3);
const author = '111111@lid', targetId = 'original-id';
const at = 1789653332684;
function integer(n: number): Buffer {
  const bytes = [];
  do { const value = n % 128; n = Math.floor(n / 128); bytes.push(value | (n ? 128 : 0)); } while (n);
  return Buffer.from(bytes);
}
function field(n: number, value: string | Buffer | number): Buffer {
  if (typeof value === 'number') return Buffer.concat([integer(n * 8), integer(value)]);
  const body = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([integer(n * 8 + 2), integer(body.length), body]);
}
function fixture(plain = field(12, Buffer.concat([field(1, field(3, targetId)), field(2, 14), field(14, field(1, 'Texto atualizado')), field(15, at)]))) {
  vi.stubGlobal('crypto', webcrypto);
  const key = hkdfSync('sha256', secret, Buffer.alloc(0), Buffer.from(targetId + author + author + 'Message Edit'), 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const original = { key: { id: targetId, fromMe: false, remoteJid: author, remoteJidAlt: '5511999999999@s.whatsapp.net' },
    message: { conversation: 'Texto original', messageContextInfo: { messageSecret: secret.toString('base64') } } };
  const envelope = { key: { id: 'edit-envelope-id', fromMe: false, remoteJid: author }, messageTimestamp: Math.floor(at / 1000),
    message: { secretEncryptedMessage: { secretEncType: 2, targetMessageKey: { id: targetId, fromMe: true, remoteJid: 'own@lid' },
      encIv: iv.toString('base64'), encPayload: payload.toString('base64') } } };
  return { envelope, original };
}
it('decrypts an authenticated protocol edit using original sender identity, not the inverted target key', async () => {
  const { envelope, original } = fixture();
  expect(await decryptIncomingEdit(envelope, original)).toEqual({ targetId, text: 'Texto atualizado', editedAt: new Date(at).toISOString() });
});
it('supports direct extended text as well as nested protocol edits', async () => {
  const { envelope, original } = fixture(field(6, field(1, 'Texto longo')));
  expect((await decryptIncomingEdit(envelope, original)).text).toBe('Texto longo');
});
it('rejects tampering and wrong targets instead of accepting unauthenticated text', async () => {
  const f = fixture();
  f.envelope.message.secretEncryptedMessage.encPayload = Buffer.alloc(64, 5).toString('base64');
  await expect(decryptIncomingEdit(f.envelope, f.original)).rejects.toThrow('authentication failed');
  const wrong = fixture(field(12, Buffer.concat([field(1, field(3, 'another-id')), field(2, 14), field(14, field(1, 'Wrong target'))])));
  await expect(decryptIncomingEdit(wrong.envelope, wrong.original)).rejects.toThrow('target mismatch');
});
it('does not apply edits across conversations or for outgoing originals', async () => {
  const f = fixture(); f.original.key.remoteJid = 'other@lid';
  await expect(decryptIncomingEdit(f.envelope, f.original)).rejects.toThrow('conversation mismatch');
  f.original.key.fromMe = true;
  await expect(decryptIncomingEdit(f.envelope, f.original)).rejects.toThrow('identity');
});
it('rejects malformed protobuf and non-text edits', async () => {
  for (const plain of [Buffer.from([10, 127]), field(8, field(1, 'audio')), Buffer.from([0])]) {
    const f = fixture(plain);
    await expect(decryptIncomingEdit(f.envelope, f.original)).rejects.toThrow();
  }
});
it('ignores encrypted non-edit events and normal messages', () => {
  expect(encryptedEdit({ message: { conversation: 'hello' } })).toBeNull();
  expect(encryptedEdit({ message: { secretEncryptedMessage: { secretEncType: 1, targetMessageKey: { id: targetId } } } })).toBeNull();
});
function dbFixture(deleted = false, missing = false) {
  const filters: unknown[] = [];
  const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
    maybeSingle: async () => ({ data: missing ? null : { id: 'crm-row', direction: 'in', deleted_at: deleted ? 'today' : null }, error: null }) };
  return { db: { from: () => q }, filters };
}
const connection = { id: 'conn', base_url: 'https://provider.test', instance_token: 'fake-token', instance_name: 'test instance' };
it('looks up the exact original only after checking tenant and connection, using a read endpoint', async () => {
  const f = fixture(), db = dbFixture();
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ messages: { records: [f.original] } }));
  vi.stubGlobal('fetch', fetchMock);
  expect((await resolveEncryptedEdit(db.db, 'org', connection, f.envelope))?.text).toBe('Texto atualizado');
  expect(db.filters).toContainEqual(['organization_id', 'org']);
  expect(db.filters).toContainEqual(['wa_conversations.connection_id', 'conn']);
  expect(fetchMock).toHaveBeenCalledWith('https://provider.test/chat/findMessages/test%20instance', expect.objectContaining({ method: 'POST', body: JSON.stringify({ where: { key: { id: targetId } }, page: 1, offset: 1 }) }));
});
it('does not fetch or resurrect a deleted message and fails retryably when original is missing', async () => {
  const f = fixture(); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  expect(await resolveEncryptedEdit(dbFixture(true).db, 'org', connection, f.envelope)).toBeNull();
  await expect(resolveEncryptedEdit(dbFixture(false, true).db, 'org', connection, f.envelope)).rejects.toThrow('not yet stored');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('fails rather than silently discarding provider lookup errors', async () => {
  const f = fixture(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 503 })));
  await expect(resolveEncryptedEdit(dbFixture().db, 'org', connection, f.envelope)).rejects.toThrow('lookup rejected');
});
