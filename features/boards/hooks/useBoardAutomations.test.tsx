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
it('keeps consumption separate and clears its badge from the next authoritative refetch', async () => {
  const block = { conversationId: 'conversation', blockedAt: '2026-10-23T13:00:00Z', reason: 'conversation_token_limit' };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ automations: { [id]: null }, usageBlocks: { [id]: block } }))
    .mockResolvedValueOnce(Response.json({ automations: { [id]: null }, usageBlocks: {} }));
  vi.stubGlobal('fetch', fetch);
  const { Wrapper, client } = wrapper();
  const { result } = renderHook(() => useBoardAutomations('org', 'user', [id]), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.usageBlocks[id]).toEqual(block));
  expect(result.current.data[id]).toBeNull();
  await act(async () => { await client.invalidateQueries({ queryKey: ['board-automation-state'] }); });
  await waitFor(() => expect(result.current.usageBlocks[id]).toBeUndefined());
});
it('does not carry a consumption block across organization changes', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ automations: { [id]: null }, usageBlocks: { [id]: { conversationId: 'c', blockedAt: 'now', reason: null } } }))
    .mockImplementationOnce(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  const { Wrapper } = wrapper();
  const { result, rerender } = renderHook(({ org }) => useBoardAutomations(org, 'user', [id]), { wrapper: Wrapper, initialProps: { org: 'first' } });
  await waitFor(() => expect(result.current.usageBlocks[id]).toBeDefined());
  rerender({ org: 'second' });
  expect(result.current.usageBlocks).toEqual({});
});
it('retains known blocks only in failed batches and clears them after an authoritative empty refresh', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`);
  const first = ids[0], last = ids[100];
  const block = { conversationId: 'conversation', blockedAt: '2026-10-23T13:00:00Z', reason: 'conversation_token_limit' };
  let round = 0;
  const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const batch = (JSON.parse(String(init.body)) as { dealIds: string[] }).dealIds;
    return Response.json({
      automations: Object.fromEntries(batch.map(id => [id, null])),
      usageBlocks: round === 0 ? Object.fromEntries(batch.filter(id => id === first || id === last).map(id => [id, block])) : {},
      usageBlocksUnavailable: round === 1 && batch.includes(first),
    });
  });
  vi.stubGlobal('fetch', fetch);
  const { Wrapper, client } = wrapper();
  const { result } = renderHook(() => useBoardAutomations('org', 'user', ids), { wrapper: Wrapper });
  await waitFor(() => expect(Object.keys(result.current.usageBlocks)).toHaveLength(2));
  round = 1;
  await act(async () => { await client.invalidateQueries({ queryKey: ['board-automation-state'] }); });
  await waitFor(() => expect(result.current.usageBlocksUnavailable).toBe(true));
  expect(result.current.usageBlocks).toEqual({ [first]: block });
  expect(result.current.data[last]).toBeNull();
  round = 2;
  await act(async () => { await client.invalidateQueries({ queryKey: ['board-automation-state'] }); });
  await waitFor(() => expect(result.current.usageBlocksUnavailable).toBe(false));
  expect(result.current.usageBlocks).toEqual({});
});
