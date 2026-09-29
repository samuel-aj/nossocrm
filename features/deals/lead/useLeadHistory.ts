'use client';
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import type { DealHistory } from './useDealHistory';
import { leadHistoryKey, refreshTimelinePages, type LeadHistoryPage } from './timelinePage';
export { leadHistoryKey } from './timelinePage';
export type { LeadHistoryPage } from './timelinePage';
export async function fetchLeadHistoryPage(dealId: string, cursor: string | null, signal: AbortSignal): Promise<LeadHistoryPage> {
  const res = await fetch(`/api/deals/${dealId}/timeline${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal, credentials: 'include', headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.history || !Array.isArray(body.activities)) throw new Error(body?.error || 'Falha ao carregar o histórico');
  return body;
}
const latestRefresh = new WeakMap<QueryClient, Map<string, number>>();
export function useLeadHistory(orgId: string | null | undefined, dealId: string | null | undefined, enabled = true) {
  const client = useQueryClient();
  const [refreshFailure, setRefreshFailure] = useState<{ org: string; deal: string; error: Error; updatedAt: number | undefined } | null>(null);
  const active = !!orgId && !!dealId && enabled;
  const query = useInfiniteQuery({
    queryKey: leadHistoryKey(orgId ?? '', dealId ?? ''), enabled: active,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchLeadHistoryPage(dealId!, pageParam, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 30_000, refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  // deal_events is not published. Revalidate only the newest bounded page while
  // visible. Existing older pages stay anchored; their cursor is unchanged.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible' || pending || client.isFetching({ queryKey: leadHistoryKey(orgId!, dealId!) })) return;
      const times = latestRefresh.get(client) ?? new Map<string, number>();
      latestRefresh.set(client, times);
      const identity = `${orgId}:${dealId}`;
      if (Date.now() - (times.get(identity) ?? 0) < 29_000) return;
      times.set(identity, Date.now());
      pending = true;
      const startedAt = client.getQueryState(leadHistoryKey(orgId!, dealId!))?.dataUpdatedAt;
      try {
        const page = await fetchLeadHistoryPage(dealId!, null, controller.signal);
        if (client.isFetching({ queryKey: leadHistoryKey(orgId!, dealId!) }) || client.getQueryState(leadHistoryKey(orgId!, dealId!))?.dataUpdatedAt !== startedAt) return;
        if (!controller.signal.aborted) setRefreshFailure(null);
        if (!controller.signal.aborted) client.setQueryData<InfiniteData<LeadHistoryPage, string | null>>(leadHistoryKey(orgId!, dealId!), old => {
          if (!old) return old;
          return old.pages.length === 1 ? { pages: [page], pageParams: [null] } : { ...old, pages: refreshTimelinePages(page, old.pages) };
        });
      } catch (error) { if (!controller.signal.aborted) setRefreshFailure({ org: orgId!, deal: dealId!, error: error as Error, updatedAt: startedAt }); }
      finally { pending = false; }
    }, 30_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [active, orgId, dealId, client]);
  const projection = useMemo(() => {
    const pages = query.data?.pages ?? [];
    const history: DealHistory = { available: pages[0]?.history.available ?? false, since: pages[0]?.history.since ?? null, events: [], apiNotes: [], activityMeta: {} };
    const activities = new Map<string, LeadHistoryPage['activities'][number]>();
    const eventIds = new Set<string>(), noteIds = new Set<string>();
    for (const page of pages) {
      for (const a of page.activities) if (!activities.has(a.id)) activities.set(a.id, a);
      for (const e of page.history.events) if (!eventIds.has(e.id)) { eventIds.add(e.id); history.events.push(e); }
      for (const n of page.history.apiNotes) if (!noteIds.has(n.id)) { noteIds.add(n.id); history.apiNotes.push(n); }
      Object.assign(history.activityMeta, page.history.activityMeta);
    }
    history.events.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { history, activities: [...activities.values()] };
  }, [query.data]);
  const backgroundError = refreshFailure && refreshFailure.org === orgId && refreshFailure.deal === dealId && refreshFailure.updatedAt === query.dataUpdatedAt ? refreshFailure.error : null;
  return { ...query, ...projection, isError: query.isError || !!backgroundError, error: query.error ?? backgroundError };
}
