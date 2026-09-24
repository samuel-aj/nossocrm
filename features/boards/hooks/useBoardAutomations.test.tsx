import React, { type PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useBoardAutomations } from './useBoardAutomations';
const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, Wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
it('never carries a previous organization projection into another organization', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ automations: { [id]: { kind: 'bot', name: 'Bot A', state: 'running' } } }))
    .mockImplementationOnce(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  const { Wrapper } = wrapper();
  const { result, rerender } = renderHook(({ org }) => useBoardAutomations(org, 'user', [id]), { wrapper: Wrapper, initialProps: { org: 'a' } });
  await waitFor(() => expect(result.current.data[id]?.kind).toBe('bot'));
  rerender({ org: 'b' });
  expect(result.current.data[id]).toBeUndefined();
  expect(result.current.loading).toBe(true);
  expect(fetch.mock.calls[1][1].headers['x-org-id']).toBe('b');
});
it('updates running to no automation from the server, preserving one query for all cards', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ automations: { [id]: { kind: 'ai', name: 'Bia', state: 'active' } } }))
    .mockResolvedValueOnce(Response.json({ automations: { [id]: null } }));
  vi.stubGlobal('fetch', fetch);
  const { Wrapper, client } = wrapper();
  const { result } = renderHook(() => useBoardAutomations('org', 'user', [id, id]), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.data[id]?.kind).toBe('ai'));
  expect(JSON.parse(fetch.mock.calls[0][1].body).dealIds).toEqual([id]);
  await act(async () => { await client.invalidateQueries({ queryKey: ['board-automation-state'] }); });
  await waitFor(() => expect(result.current.data[id]).toBeNull());
});
