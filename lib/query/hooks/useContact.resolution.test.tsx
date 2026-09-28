import React from 'react';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../queryKeys';
import type { Contact } from '@/types';
const mocks = vi.hoisted(() => ({ byId: vi.fn(), all: vi.fn(), org: 'org-a' }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' }, loading: false }) }));
vi.mock('@/lib/supabase', () => ({ contactsService: { getById: mocks.byId, getAll: mocks.all }, companiesService: {} }));
vi.mock('@/lib/tabOrg', () => ({ readTabOrg: () => ({ id: mocks.org }) }));
import { useContact } from './useContactsQuery';
const contact = { id: 'cintia', name: 'Cintia', phone: '+5569999999999', updatedAt: '2026-09-28T12:00:00Z' } as Contact;
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 60000 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
beforeEach(() => { vi.clearAllMocks(); mocks.org = 'org-a'; mocks.byId.mockResolvedValue({ data: contact, error: null }); focusManager.setFocused(true); onlineManager.setOnline(true); });
describe('open contact lookup', () => {
  it('loads the exact contact missing from a partial list without fetching all contacts', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.contacts.lists(), [{ ...contact, id: 'other' }]);
    const { result } = renderHook(() => useContact('cintia'), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe('cintia'));
    expect(mocks.byId).toHaveBeenCalledWith('cintia', expect.any(AbortSignal));
    expect(mocks.all).not.toHaveBeenCalled();
    expect(client.getQueryData<Contact[]>(queryKeys.contacts.lists())?.map(c => c.id)).toEqual(['other', 'cintia']);
  });
  it('does not pretend a detail fetch is the full contact list', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useContact('cintia'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(queryKeys.contacts.lists())).toBeUndefined();
  });
  it('keeps confirmed contact data on a transient refetch failure', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => {
      const query = useContact('cintia');
      return { data: query.data, isError: query.isError, refetch: query.refetch };
    }, { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe('cintia'));
    mocks.byId.mockResolvedValue({ data: null, error: new Error('offline') });
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data?.id).toBe('cintia');
  });
  it('deduplicates concurrent consumers of the same contact', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => [useContact('cintia'), useContact('cintia')], { wrapper });
    await waitFor(() => expect(result.current.every(q => q.isSuccess)).toBe(true));
    expect(mocks.byId).toHaveBeenCalledTimes(1);
  });
  it('rejects an old organization response before it reaches the shared list', async () => {
    const { client, wrapper } = setup();
    let resolve!: (value: unknown) => void;
    mocks.byId.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { unmount } = renderHook(() => useContact('cintia'), { wrapper });
    await waitFor(() => expect(mocks.byId).toHaveBeenCalled());
    mocks.org = 'org-b';
    unmount();
    await act(async () => resolve({ data: contact, error: null }));
    expect(client.getQueryData(queryKeys.contacts.lists())).toBeUndefined();
  });
  it('revalidates stale data after reconnecting', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useContact('cintia'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    act(() => { onlineManager.setOnline(false); });
    await client.invalidateQueries({ queryKey: queryKeys.contacts.detail('cintia'), refetchType: 'none' });
    mocks.byId.mockResolvedValue({ data: { ...contact, name: 'Updated' }, error: null });
    act(() => { onlineManager.setOnline(true); });
    await waitFor(() => expect(result.current.data?.name).toBe('Updated'));
  });
});
