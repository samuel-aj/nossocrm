export type ConversationSummary = {
  connectionId: string | null;
  conversationId: string | null;
  lastAt: string | null;
  unread: number;
  labelIds: string[];
};

/** Present the already authorized rows together. No persisted records are merged. */
export function unifyConversations<T extends ConversationSummary>(rows: T[]) {
  if (!rows.length) return [];
  const ordered = [...rows].sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  return [{
    ...ordered[0],
    connectionId: null,
    initialSenderId: ordered[0].connectionId,
    conversationId: null,
    conversationIds: [...new Set(rows.flatMap(r => r.conversationId ? [r.conversationId] : []))],
    connectionIds: [...new Set(rows.flatMap(r => r.connectionId ? [r.connectionId] : []))],
    unread: rows.reduce((sum, row) => sum + row.unread, 0),
    labelIds: [...new Set(rows.flatMap(row => row.labelIds))],
  }];
}
