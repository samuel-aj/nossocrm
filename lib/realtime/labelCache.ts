import type { QueryClient } from '@tanstack/react-query';
import { DEALS_VIEW_KEY, queryKeys } from '@/lib/query/queryKeys';

export async function refreshLinkedLabels(client: QueryClient, catalog = false) {
  if (catalog && typeof window !== 'undefined') window.dispatchEvent(new Event('crm:labels-changed'));
  await Promise.all([
    client.invalidateQueries({ queryKey: ['waConversations'] }),
    client.invalidateQueries({ queryKey: DEALS_VIEW_KEY }),
    client.invalidateQueries({ queryKey: queryKeys.deals.lists() }),
    client.invalidateQueries({ queryKey: queryKeys.deals.details() }),
    ...(catalog ? [client.invalidateQueries({ queryKey: ['waLabels'] }), client.invalidateQueries({ queryKey: ['waAgents', 'options'] })] : []),
  ]);
}
