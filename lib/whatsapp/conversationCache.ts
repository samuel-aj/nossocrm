import type { QueryClient } from '@tanstack/react-query';

/** The unread counter shares the prefix but is not a conversation list. */
export function patchConversationCache(
  client: QueryClient,
  id: string,
  patch: object,
) {
  client.setQueriesData<{ data?: Array<{ id: string }> }>(
    { queryKey: ['waConversations'] },
    old => old && Array.isArray(old.data) ? {
      ...old,
      data: old.data.map(conversation => conversation.id === id ? { ...conversation, ...patch } : conversation),
    } : old,
  );
}
