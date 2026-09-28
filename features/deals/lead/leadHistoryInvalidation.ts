import type { QueryClient } from '@tanstack/react-query';
import type { LeadHistoryPage } from './timelinePage';
/** Invalidate the read projection only; canonical entity cache stays untouched. */
export function invalidateLeadHistory(client: QueryClient, orgId: string | null | undefined, dealId?: string | null, activityId?: string) {
  if (!orgId) return Promise.resolve();
  return client.invalidateQueries({ predicate: q => {
    if (q.queryKey[0] !== 'leadHistory' || q.queryKey[1] !== orgId) return false;
    if (dealId) return q.queryKey[2] === dealId;
    const data = q.state.data as { pages?: LeadHistoryPage[] } | undefined;
    return !!activityId && !!data?.pages?.some(p => p.activities.some(a => a.id === activityId) || p.history.apiNotes.some(n => n.id === activityId));
  } });
}
