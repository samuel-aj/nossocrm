import { expect, it } from 'vitest';
import { unifyConversations } from './unifiedConversation';
it('aggregates unread and labels while choosing the newest preview and sender, without mutating rows', () => {
  const rows = [
    { conversationId: 'a', connectionId: 'one', lastAt: '2026-09-23', preview: 'Antiga', unread: 2, labelIds: ['x'] },
    { conversationId: 'b', connectionId: 'two', lastAt: '2026-09-24', preview: 'Nova', unread: 3, labelIds: ['x', 'y'] },
  ];
  expect(unifyConversations(rows)).toEqual([expect.objectContaining({
    conversationId: null, connectionId: null, initialSenderId: 'two', preview: 'Nova', unread: 5,
    conversationIds: ['a', 'b'], connectionIds: ['one', 'two'], labelIds: ['x', 'y'],
  })]);
  expect(rows[0].conversationId).toBe('a');
  expect(unifyConversations([])).toEqual([]);
});
it('keeps a block from an older sending number and clears only when authoritative rows clear it', () => {
  const block = { conversationId: 'older', reason: 'conversation_token_limit', blockedAt: '2026-10-23T10:00:00Z' };
  const rows = [
    { conversationId: 'older', connectionId: 'one', lastAt: '2026-10-22', unread: 0, labelIds: [], usageBlock: block },
    { conversationId: 'newer', connectionId: 'two', lastAt: '2026-10-23', unread: 2, labelIds: [], usageBlock: null },
  ];
  expect(unifyConversations(rows)[0]).toMatchObject({ initialSenderId: 'two', usageBlock: block, unread: 2 });
  expect(unifyConversations(rows.map(row => ({ ...row, usageBlock: null })))[0].usageBlock).toBeNull();
  expect(rows[0].usageBlock).toEqual(block);
});
