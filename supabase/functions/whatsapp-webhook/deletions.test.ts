import { expect, it } from 'vitest';
import { parseMessageDeletion, applyMessageDeletion } from './deletions';
const at = '2026-09-17T13:00:00.000Z';
it('uses provider keys, not database/envelope IDs, in both Evolution deletion shapes', () => {
  expect(parseMessageDeletion('messages.delete', { id: 'target', status: 'DELETED' }, at)).toEqual({ targetId: 'target', deletedAt: at });
  expect(parseMessageDeletion('messages.delete', { id: 'database-id', key: { id: 'target' }, status: 'DELETED' }, at)?.targetId).toBe('target');
  expect(parseMessageDeletion('messages.upsert', { key: { id: 'envelope' }, message: { protocolMessage: { type: 0, key: { id: 'target' } } } }, at)?.targetId).toBe('target');
});
it('ignores delivery updates, normal content and chat clears', () => {
  expect(parseMessageDeletion('messages.update', { id: 'target', status: 'READ' })).toBeNull();
  expect(parseMessageDeletion('messages.delete', { all: true, jid: 'chat' })).toBeNull();
  expect(parseMessageDeletion('messages.upsert', { key: { id: 'target' }, message: { conversation: 'hello' } })).toBeNull();
});
it('marks rather than removes content, scoped to the original tenant and connection', async () => {
  const writes: unknown[] = [], filters: unknown[] = [];
  const db = { from: (table: string) => {
    const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([table, k, v]); return q; },
      is: (k: string, v: unknown) => { filters.push([table, k, v]); return q; }, order: () => q, limit: () => q,
      update: (patch: unknown) => { writes.push([table, patch]); return q; },
      maybeSingle: async () => ({ data: table === 'wa_messages' ? { id: 'row', conversation_id: 'conv' } : { last_message_at: at } }),
      then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
    return q;
  } };
  await applyMessageDeletion(db, 'org', 'conn', { targetId: 'target', deletedAt: at });
  expect(filters).toContainEqual(['wa_messages', 'organization_id', 'org']);
  expect(filters).toContainEqual(['wa_messages', 'wa_conversations.connection_id', 'conn']);
  expect(filters).toContainEqual(['wa_messages', 'deleted_at', null]);
  expect(writes).toEqual([['wa_messages', { deleted_at: at }], ['wa_conversations', { last_message_preview: 'Mensagem excluída' }]]);
});
