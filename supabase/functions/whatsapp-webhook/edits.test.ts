import { describe, expect, it } from 'vitest';
import { parseMessageEdit, applyMessageEdit } from './edits';
const at = '2026-09-17T12:50:00.000Z';
const proto = { key: { id: 'original' }, timestampMs: Date.parse(at), editedMessage: { conversation: 'Beleza Samuel' } };
describe('Evolution edit normalization', () => {
  it.each(['messages.edited', 'send.message.update'])('reads %s direct protocol with original id', event => {
    expect(parseMessageEdit(event, proto)).toEqual({ targetId: 'original', text: 'Beleza Samuel', editedAt: at });
  });
  it.each([
    ['messages.upsert', { key: { id: 'envelope' }, message: { protocolMessage: proto } }],
    ['messages.upsert', { message: { editedMessage: { message: { protocolMessage: proto } } } }],
    ['messages.update', { key: { id: 'envelope' }, update: { message: { protocolMessage: proto } } }],
    ['messages.update', { message: { ephemeralMessage: { message: { protocolMessage: proto } } } }],
  ])('unwraps %s', (event, item) => {
    expect(parseMessageEdit(event, item)).toEqual({ targetId: 'original', text: 'Beleza Samuel', editedAt: at });
  });
  it('accepts explicit text events and ignores delivery/read/reaction/regular messages', () => {
    expect(parseMessageEdit('messages.edited', { keyId: 'original', text: 'Corrigido' }, at)?.text).toBe('Corrigido');
    expect(parseMessageEdit('messages.update', { key: { id: 'a' }, update: { status: 'READ' } })).toBeNull();
    expect(parseMessageEdit('messages.upsert', { key: { id: 'a' }, message: { conversation: 'Novo' } })).toBeNull();
    expect(parseMessageEdit('messages.upsert', { message: { reactionMessage: { text: '👍' } } })).toBeNull();
  });
});

describe('edit persistence', () => {
  function fake(body = 'Beleza', editedAt: string | null = null) {
    const writes: unknown[] = [], filters: unknown[] = [];
    const db = { from: (table: string) => {
      const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; }, is: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
        update: (patch: unknown) => { writes.push([table, patch]); return q; }, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === 'wa_messages' ? { id: 'row', body, edited_at: editedAt, conversation_id: 'conv' } : { last_message_at: at } }),
        then: (resolve: (value: unknown) => void) => resolve({ data: [{ id: 'row' }], error: null }) };
      return q;
    } };
    return { db, writes, filters };
  }
  it('scopes by org and connection, preserves dates/status and updates preview', async () => {
    const f = fake();
    await applyMessageEdit(f.db, 'org', 'conn', { targetId: 'original', text: 'Beleza Samuel', editedAt: at });
    expect(f.filters).toContainEqual(['wa_messages', 'wa_conversations.connection_id', 'conn']);
    expect(f.filters).toContainEqual(['wa_messages', 'organization_id', 'org']);
    expect(f.writes).toEqual([['wa_messages', { body: 'Beleza Samuel', edited_at: at }], ['wa_conversations', { last_message_preview: 'Beleza Samuel' }]]);
  });
  it('ignores duplicate text and older events', async () => {
    for (const f of [fake('Beleza Samuel', at), fake('Mais recente', '2026-09-17T12:51:00Z')]) {
      await applyMessageEdit(f.db, 'org', 'conn', { targetId: 'original', text: 'Beleza Samuel', editedAt: at });
      expect(f.writes).toEqual([]);
    }
  });
});
