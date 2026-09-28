import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEALS_VIEW_KEY, queryKeys } from '../queryKeys';
import type { Deal } from '@/types';
const mocks = vi.hoisted(() => ({ byId: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' }, loading: false }) }));
vi.mock('@/lib/supabase', () => ({ dealsService: { getById: mocks.byId }, contactsService: {}, companiesService: {}, boardStagesService: {} }));
vi.mock('@/lib/tabOrg', () => ({ readTabOrg: () => ({ id: 'org' }) }));
import { useDeal } from './useDealsQuery';
const cached = { id: 'lead', contactId: '', status: 'old', updatedAt: '2026-09-28T12:00:00Z' } as Deal;
const confirmed = { ...cached, contactId: 'contact', status: 'qualified', updatedAt: '2026-09-28T12:01:00Z' };
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  clients.push(client);
  client.setQueryData(DEALS_VIEW_KEY, [cached]);
  client.setQueryData(queryKeys.deals.detail('lead'), cached);
  return { client, wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => mocks.byId.mockReset().mockResolvedValue({ data: confirmed, error: null }));
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); });
describe('open lead revalidation', () => {
  it('refreshes an existing cached lead and repairs its stale contact and stage without a page reload', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useDeal('lead'), { wrapper });
    await waitFor(() => expect(result.current.data?.contactId).toBe('contact'));
    expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0].status).toBe('qualified');
    expect(mocks.byId).toHaveBeenCalledWith('lead', expect.any(AbortSignal));
  });
  it('keeps a newer realtime version when the request returns an older snapshot', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(DEALS_VIEW_KEY, [{ ...confirmed, status: 'meeting', updatedAt: '2026-09-28T12:02:00Z' }]);
    const { result } = renderHook(() => useDeal('lead'), { wrapper });
    await waitFor(() => expect(result.current.data?.status).toBe('meeting'));
  });
  it('distinguishes an inaccessible/deleted lead from an incomplete local list', async () => {
    mocks.byId.mockResolvedValue({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeal('lead'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(result.current.isSuccess).toBe(true);
  });
});
