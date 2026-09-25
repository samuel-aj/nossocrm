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
