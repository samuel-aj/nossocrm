import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ org: 'org-a' }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { organization_id: mocks.org } }) }));
vi.mock('@/lib/tabOrg', () => ({ readTabOrg: () => ({ id: mocks.org }) }));
import { useConversationLead } from './useConversationLead';

const conversation = { id: 'chat', contact_id: 'contact', deal_id: null, deal_link_mode: 'auto', is_group: false };
const key = ['waConversations', 'org-a'];
const fetcher = vi.fn();
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  clients.push(client);
  client.setQueryData(key, { data: [conversation, { ...conversation, id: 'other' }] });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
function response(dealId: string | null = 'lead') {
  return new Response(JSON.stringify({ conversation: { ...conversation, deal_id: dealId, label_ids: ['label'] } }));
}
beforeEach(() => { mocks.org = 'org-a'; fetcher.mockReset().mockImplementation(async () => response()); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals(); });
describe('open chat lead resolution', () => {
  it('persists the authoritative response into the list and deduplicates consumers', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => [useConversationLead(conversation), useConversationLead(conversation)], { wrapper });
    await waitFor(() => expect(result.current.every(q => q.isSuccess)).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(key)).toEqual({ data: [{ ...conversation, deal_id: 'lead', label_ids: ['label'] }, { ...conversation, id: 'other' }] });
  });
  it.each([
    { ...conversation, is_group: true },
    { ...conversation, deal_id: 'existing' },
    { ...conversation, deal_link_mode: 'manual' },
    { ...conversation, contact_id: null },
  ])('does not resolve a group, existing link, manual choice or missing contact: %j', async value => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useConversationLead(value), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('retains ambiguity returned by the server instead of choosing a lead', async () => {
    fetcher.mockImplementation(async () => response(null));
    const { wrapper } = setup();
    const { result } = renderHook(() => useConversationLead(conversation), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.deal_id).toBeNull();
  });
  it('reports server failures without changing the cached link', async () => {
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: 'offline' }), { status: 500 }));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useConversationLead(conversation), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(key)).toEqual({ data: [conversation, { ...conversation, id: 'other' }] });
  });
  it('does not overwrite a manual unlink when its older response arrives late', async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { client, wrapper } = setup();
    renderHook(() => useConversationLead(conversation), { wrapper });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    await act(async () => {
      await client.cancelQueries({ queryKey: ['waConversationLink'] });
      client.setQueryData(key, { data: [{ ...conversation, deal_link_mode: 'manual' }] });
      resolve(response());
    });
    expect(client.getQueryData(key)).toEqual({ data: [{ ...conversation, deal_link_mode: 'manual' }] });
  });
  it('rejects an old organization response before changing the list', async () => {
    let resolve!: (value: Response) => void;
    fetcher.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { client, wrapper } = setup();
    const { unmount } = renderHook(() => useConversationLead(conversation), { wrapper });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    mocks.org = 'org-b';
    unmount();
    await act(async () => resolve(response()));
    expect(client.getQueryData(key)).toEqual({ data: [conversation, { ...conversation, id: 'other' }] });
  });
});
