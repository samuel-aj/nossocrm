import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOrgPreferences } from './useOrgPreferences';
import { DEFAULT_LEAD_SOURCES } from '@/lib/deals/leadSource';

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...renderHook(() => useOrgPreferences(), { wrapper: ({ children }) => React.createElement(QueryClientProvider, { client }, children) }) };
}
it('updates source categories in the existing preferences cache, preserving other preferences', async () => {
  let options: string[] | null = ['Meta Ads'];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      options = JSON.parse(String(init.body)).lead_source_options;
      return Response.json({ ok: true, lead_source_options: options });
    }
    return Response.json({ inactive_leads_enabled: true, lead_source_options: options });
  });
  vi.stubGlobal('fetch', fetcher);
  const { result, client } = setup();
  await waitFor(() => expect(result.current.leadSourceOptions).toEqual(['Meta Ads']));
  await act(async () => { await result.current.setLeadSourceOptions.mutateAsync(['Indicação']); });
  await waitFor(() => expect(result.current.leadSourceOptions).toEqual(['Indicação']));
  expect(client.getQueryData(['orgPreferences'])).toMatchObject({ inactive_leads_enabled: true, lead_source_options: ['Indicação'] });
  expect(client.getQueryCache().getAll()).toHaveLength(1);
  await act(async () => { await result.current.setLeadSourceOptions.mutateAsync([]); });
  await waitFor(() => expect(result.current.leadSourceOptions).toEqual([]));
  await act(async () => { await result.current.setLeadSourceOptions.mutateAsync(null); });
  await waitFor(() => expect(result.current.leadSourceOptions).toEqual(DEFAULT_LEAD_SOURCES));
});
it('retains confirmed categories and propagates permission failures', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
    ? Response.json({ error: 'Forbidden' }, { status: 403 }) : Response.json({ lead_source_options: ['Meta Ads'] })));
  const { result } = setup();
  await waitFor(() => expect(result.current.leadSourceOptions).toEqual(['Meta Ads']));
  await act(async () => { await expect(result.current.setLeadSourceOptions.mutateAsync(['Outro canal'])).rejects.toThrow('Forbidden'); });
  expect(result.current.leadSourceOptions).toEqual(['Meta Ads']);
});
