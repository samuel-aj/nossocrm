import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLeadHistoryPage, useLeadHistory } from './useLeadHistory';
const page = { activities: [], nextCursor: null, history: { available: true, since: null, events: [], activityMeta: {}, apiNotes: [] } };
afterEach(() => { vi.unstubAllGlobals(); });
describe('lead history reader', () => {
  it('surfaces server failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'denied' }, { status: 500 })));
    await expect(fetchLeadHistoryPage('lead', null, new AbortController().signal)).rejects.toThrow('denied');
  });
  it('aborts old selection and isolates delayed responses on organization switch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let signal: AbortSignal; let finish: (r: Response) => void;
    const fetch = vi.fn().mockImplementationOnce((_url, options) => { signal = options.signal; return new Promise<Response>(resolve => { finish = resolve; }); }).mockResolvedValue(Response.json(page));
    vi.stubGlobal('fetch', fetch);
    const { result, rerender, unmount } = renderHook(({ org }) => useLeadHistory(org, 'lead'), { initialProps: { org: 'orgA' }, wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const abortedSignal = signal!;
    rerender({ org: 'orgB' });
    expect(abortedSignal.aborted).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => finish(Response.json({ ...page, activities: [{ id: 'secret' }] })));
    expect(result.current.activities).toEqual([]);
    unmount(); client.clear();
  });
});
it('revalidates only the first page on the visible timer when older pages are loaded', async () => {
 vi.useFakeTimers();
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 client.setQueryData(['leadHistory', 'org', 'lead'], { pages: [page, page], pageParams: [null, 'older'] });
 const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(page)));
 vi.stubGlobal('fetch', fetch);
 vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
 const { unmount } = renderHook(() => useLeadHistory('org', 'lead'), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
 await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
 expect(fetch).toHaveBeenCalledTimes(1);
 expect(fetch.mock.calls[0][0]).toBe('/api/deals/lead/timeline');
 unmount(); client.clear(); vi.useRealTimers(); vi.restoreAllMocks();
});
