import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Journal, JournalItem, Operation } from './journal';
import { sequenceHash } from './journal';
import type { SequenceInput } from './schemas';
import type { WhatsAppContext } from './access';

const m = vi.hoisted(() => ({ sendText: vi.fn(), sendMedia: vi.fn(), record: vi.fn(), destination: vi.fn(), attachment: vi.fn(), window: vi.fn(), statuses: [] as { id: string; status: string }[] }));
const conn = { id: 'connection', organization_id: 'org', provider: 'evolution', status: 'connected', phone_number: '+5511900000000' };
const conv = { id: 'conversation', organization_id: 'org', connection_id: 'connection', wa_phone: '120000@g.us', is_group: true };
vi.mock('./access', async importOriginal => ({ ...await importOriginal<typeof import('./access')>(), requireDestination: m.destination }));
vi.mock('./uploads', async importOriginal => ({ ...await importOriginal<typeof import('./uploads')>(), resolveAttachment: m.attachment }));
vi.mock('@/lib/permissions/server', () => ({ getVisibilityRules: async () => null, connectionAllowed: () => true }));
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: async () => true }));
vi.mock('@/lib/whatsapp/sendWindow', () => ({ checkSendWindow: m.window }));
vi.mock('@/lib/whatsapp/service', () => ({
  getConnectionByIdForOrg: async () => conn, getConnectionByOrg: async () => conn,
  getGroupConversation: async () => conv, getWaGroupsEnabled: async () => true, getQuotableMessage: vi.fn(),
  ensureConversation: vi.fn(() => { throw new Error('Must use exact conversation'); }),
  recordOutboundMessage: m.record, replicateOutboundToSiblings: vi.fn(),
}));
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ sendText: m.sendText, sendMedia: m.sendMedia }) }));
import { getSequence, resumeSequence, sendSequence } from './sequences';

class MemoryJournal implements Journal {
  operation!: Operation;
  items: JournalItem[] = [];
  hash?: string;
  failAccepted = false;
  async create(input: SequenceInput) {
    const hash = sequenceHash(input);
    if (this.hash && hash !== this.hash) throw new Error('IDEMPOTENCY_CONFLICT');
    if (this.hash) return;
    this.hash = hash;
    this.operation = { operation_id: input.operationId, actor_id: 'actor', conversation_id: input.conversationId, connection_id: input.connectionId };
    this.items = input.items.map((payload, position) => ({ item_id: payload.itemId, position, payload, state: 'pending', claim_token: '', record: null, message_id: null, provider_message_id: null, error_code: null, updated_at: new Date().toISOString() }));
  }
  async load() { return structuredClone({ operation: this.operation, items: this.items }); }
  async claim() {
    const item = this.items.find(i => i.state !== 'completed');
    if (!item || item.state !== 'pending') return null;
    item.state = 'preparing'; item.claim_token = `token-${item.item_id}`;
    return structuredClone(item);
  }
  async update(_operationId: string, item: JournalItem, expected: JournalItem['state'][], values: Partial<JournalItem>) {
    if (this.failAccepted && values.state === 'accepted') { this.failAccepted = false; throw new Error('DB timeout'); }
    const saved = this.items.find(i => i.item_id === item.item_id)!;
    if (saved.claim_token !== item.claim_token || !expected.includes(saved.state)) return false;
    Object.assign(saved, values);
    return true;
  }
}
const input = (): SequenceInput => ({ operationId: 'operation', conversationId: conv.id, connectionId: conn.id, items: [
  { itemId: 'one', type: 'text', text: '  Olá, João!\n\n*Revisão* → 😊\n' },
  { itemId: 'two', type: 'pdf', attachmentId: 'pdf', caption: '*Documento* → revisão' },
  { itemId: 'three', type: 'text', text: 'Obrigado!\nAguardamos a revisão.' },
] });
const ctx = { user: { id: 'actor', organizationId: 'org', role: 'admin' }, apiKeyId: 'key', admin: {
  from: () => { const q = { select: () => q, eq: () => q, in: async () => ({ data: m.statuses, error: null }) }; return q; },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.test/signed' }, error: null }) }) },
} } as unknown as WhatsAppContext;

beforeEach(() => {
  vi.clearAllMocks(); m.statuses = [];
  m.destination.mockResolvedValue({ connection: conn, conversation: conv });
  m.window.mockResolvedValue(null);
  m.attachment.mockResolvedValue({ path: 'org/out/sealed.pdf', kind: 'document', fileName: 'Revisão.pdf', mimeType: 'application/pdf' });
  let counter = 0;
  const send = async () => ({ ok: true, providerMessageId: `provider-${++counter}` });
  m.sendText.mockImplementation(send); m.sendMedia.mockImplementation(send);
  m.record.mockImplementation(async (_admin, record) => {
    const id = `crm-${record.providerMessageId}`;
    if (!m.statuses.some(s => s.id === id)) m.statuses.push({ id, status: record.status });
    return { id, body: record.text, status: record.status };
  });
});
describe('persistent ordered sequences through the shared chat service', () => {
  it('preserves text, PDF filename, order, audit actor and CRM IDs', async () => {
    const store = new MemoryJournal();
    const result = await sendSequence(ctx, input(), store);
    expect(result.completed).toBe(true);
    expect(m.sendText.mock.calls.map(c => c[0].text)).toEqual([input().items[0].type === 'text' && input().items[0].text, 'Obrigado!\nAguardamos a revisão.']);
    expect(m.sendMedia).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'Revisão.pdf', mimeType: 'application/pdf', kind: 'document', to: conv.wa_phone, isGroup: true }));
    expect(m.record.mock.calls.map(c => c[1].providerMessageId)).toEqual(['provider-1','provider-2','provider-3']);
    for (const call of m.record.mock.calls) expect(call[1]).toMatchObject({ orgId: 'org', conversationId: conv.id, sentBy: 'actor' });
    expect(result.items.map(i => i.deliveryStatus)).toEqual(['sent','sent','sent']);
  });
  it('returns completed results on repetition and reports later delivered/read status without sending', async () => {
    const store = new MemoryJournal(); await sendSequence(ctx, input(), store);
    m.statuses[0].status = 'read';
    expect((await sendSequence(ctx, input(), store)).items[0].deliveryStatus).toBe('read');
    await resumeSequence(ctx, 'operation', store);
    expect(m.sendText).toHaveBeenCalledTimes(2); expect(m.sendMedia).toHaveBeenCalledTimes(1);
    await expect(sendSequence(ctx, { ...input(), items: [{ itemId: 'one', type: 'text', text: 'different' }] }, store)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('serializes simultaneous requests for the same operation', async () => {
    const store = new MemoryJournal();
    const [a,b] = await Promise.all([sendSequence(ctx,input(),store),sendSequence(ctx,input(),store)]);
    expect(a.completed || b.completed).toBe(true);
    expect(m.sendText).toHaveBeenCalledTimes(2); expect(m.sendMedia).toHaveBeenCalledTimes(1);
  });
  it('resumes a pre-dispatch PDF failure without repeating the first text', async () => {
    const store = new MemoryJournal(); m.attachment.mockRejectedValueOnce(new Error('Storage unavailable'));
    const partial = await sendSequence(ctx,input(),store);
    expect(partial.items.map(i => i.state)).toEqual(['completed','pending','pending']);
    expect((await resumeSequence(ctx,'operation',store)).completed).toBe(true);
    expect(m.sendText).toHaveBeenCalledTimes(2); expect(m.sendMedia).toHaveBeenCalledTimes(1);
  });
  it('stops after a provider timeout and never resends the uncertain item', async () => {
    const store = new MemoryJournal(); m.sendMedia.mockRejectedValueOnce(new Error('timeout with secret token'));
    const partial = await sendSequence(ctx,input(),store);
    expect(partial.items.map(i => i.state)).toEqual(['completed','uncertain','pending']);
    expect(JSON.stringify(partial)).not.toContain('secret');
    await resumeSequence(ctx,'operation',store); await getSequence(ctx,'operation',store);
    expect(m.sendText).toHaveBeenCalledTimes(1); expect(m.sendMedia).toHaveBeenCalledTimes(1);
  });
  it('keeps negative provider responses uncertain and exposes observed failed history', async () => {
    const store = new MemoryJournal(); m.sendMedia.mockResolvedValueOnce({ ok: false, error: 'Provider network error token' });
    const result = await sendSequence(ctx,input(),store);
    expect(result.items[1]).toMatchObject({ state: 'uncertain', retryAllowed: false, deliveryStatus: 'failed' });
    await resumeSequence(ctx,'operation',store); expect(m.sendMedia).toHaveBeenCalledTimes(1);
  });
  it('recovers a history-write failure using the accepted provider ID, without resending', async () => {
    const store = new MemoryJournal(); m.record.mockRejectedValueOnce(new Error('database unavailable'));
    const result = await sendSequence(ctx,input(),store);
    expect(result.items[0].state).toBe('completed');
    await resumeSequence(ctx,'operation',store);
    expect(m.sendText).toHaveBeenCalledTimes(2); expect(m.sendMedia).toHaveBeenCalledTimes(1);
  });
  it('blocks replay if acceptance could not be persisted', async () => {
    const store = new MemoryJournal(); store.failAccepted = true;
    const result = await sendSequence(ctx,input(),store);
    expect(result.items[0].state).toBe('uncertain');
    await resumeSequence(ctx,'operation',store); expect(m.sendText).toHaveBeenCalledTimes(1);
  });
  it('does not invent success when provider omitted its ID and history persistence failed', async () => {
    const store = new MemoryJournal(); m.sendText.mockResolvedValueOnce({ ok: true }); m.record.mockRejectedValueOnce(new Error('db'));
    const result = await sendSequence(ctx,input(),store);
    expect(result.items[0]).toMatchObject({ state: 'uncertain', messageId: null, providerMessageId: null, retryAllowed: false });
    await resumeSequence(ctx,'operation',store); expect(m.sendText).toHaveBeenCalledTimes(1);
  });
  it('rechecks destination access when retrieving even completed operations', async () => {
    const store = new MemoryJournal(); await sendSequence(ctx,input(),store);
    m.destination.mockRejectedValue(new Error('access revoked'));
    await expect(getSequence(ctx,'operation',store)).rejects.toThrow('access revoked');
  });
});
