import { createContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AutomationMap } from '@/lib/boards/automationState';

const EMPTY: AutomationMap = {};
export const BoardAutomationsContext = createContext<{ data: AutomationMap; loading: boolean; error: boolean } | null>(null);

/** One batched projection per board view, never one request per card. No copy of the deals cache. */
export function useBoardAutomations(organizationId: string | null | undefined, userId: string | undefined, dealIds: string[]) {
  const ids = [...new Set(dealIds.filter(id => /^[0-9a-f-]{36}$/i.test(id)))].sort();
  const query = useQuery({
    queryKey: ['board-automation-state', organizationId, userId, ids],
    enabled: !!organizationId && !!userId && ids.length > 0,
    queryFn: async ({ signal }) => {
      const result: AutomationMap = {};
      // Bound request size and concurrency, including large boards.
      for (let start = 0; start < ids.length; start += 300) {
        const batches = [0, 100, 200].map(offset => ids.slice(start + offset, start + offset + 100)).filter(batch => batch.length);
        const parts = await Promise.all(batches.map(async dealIds => {
          const response = await fetch('/api/deals/automation-state', {
            method: 'POST', credentials: 'include', signal,
            headers: { 'Content-Type': 'application/json', 'x-org-id': organizationId! },
            body: JSON.stringify({ dealIds }),
          });
          if (!response.ok) throw new Error('Não foi possível atualizar as automações');
          return await response.json() as { automations: AutomationMap };
        }));
        for (const part of parts) Object.assign(result, part.automations);
      }
      return result;
    },
    staleTime: 10_000,
    // wa_* is server-only. Refresh safely through the authenticated API, also on focus/reconnect.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const data = query.isError ? EMPTY : query.data || EMPTY;
  const loading = ids.length > 0 && query.isPending;
  const error = query.isError;
  return useMemo(() => ({ data, loading, error }), [data, loading, error]);
}
