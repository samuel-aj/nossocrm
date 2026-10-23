import { createContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AutomationMap } from '@/lib/boards/automationState';
import type { UsageBlockMap } from '@/lib/ai-usage/alerts';

const EMPTY: AutomationMap = {};
const EMPTY_BLOCKS: UsageBlockMap = {};
type BoardState = { automations: AutomationMap; usageBlocks?: UsageBlockMap; usageBlocksUnavailable?: boolean };
export const BoardAutomationsContext = createContext<{ data: AutomationMap; usageBlocks?: UsageBlockMap; usageBlocksUnavailable?: boolean; loading: boolean; error: boolean } | null>(null);

/** One batched projection per board view, never one request per card. No copy of the deals cache. */
export function useBoardAutomations(organizationId: string | null | undefined, userId: string | undefined, dealIds: string[]) {
  const ids = [...new Set(dealIds.filter(id => /^[0-9a-f-]{36}$/i.test(id)))].sort();
  const client = useQueryClient();
  const queryKey = ['board-automation-state', organizationId, userId, ids];
  const query = useQuery({
    queryKey,
    enabled: !!organizationId && !!userId && ids.length > 0,
    queryFn: async ({ signal }) => {
      const result: AutomationMap = {};
      const usageBlocks: UsageBlockMap = {};
      let usageBlocksUnavailable = false;
      // Reuse only this exact org/user/batch cache. A failed supplemental read
      // is not proof that a previously blocked conversation was released.
      const previous = client.getQueryData<BoardState>(queryKey);
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
          return { state: await response.json() as BoardState, dealIds };
        }));
        for (const { state: part, dealIds: batch } of parts) {
          Object.assign(result, part.automations);
          if (part.usageBlocksUnavailable) {
            for (const id of batch) {
              const block = previous?.usageBlocks?.[id];
              if (block) usageBlocks[id] = block;
            }
          }
          Object.assign(usageBlocks, part.usageBlocks ?? {});
          usageBlocksUnavailable ||= !!part.usageBlocksUnavailable;
        }
      }
      return { automations: result, usageBlocks, usageBlocksUnavailable };
    },
    staleTime: 10_000,
    // wa_* is server-only. Refresh safely through the authenticated API, also on focus/reconnect.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const data = query.isError ? EMPTY : query.data?.automations || EMPTY;
  const usageBlocks = query.data?.usageBlocks || EMPTY_BLOCKS;
  const usageBlocksUnavailable = query.isError || !!query.data?.usageBlocksUnavailable;
  const loading = ids.length > 0 && query.isPending;
  const error = query.isError;
  return useMemo(() => ({ data, usageBlocks, usageBlocksUnavailable, loading, error }), [data, usageBlocks, usageBlocksUnavailable, loading, error]);
}
