import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBoardFilters } from './useBoardFilters';
import { EMPTY_GENERAL, EMPTY_PERIOD } from './boardFilters';
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
const response = (v: unknown) => ({ ok: true, json: async () => v });
function wrapper() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); return function Wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }; }
describe('personal board filter defaults', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ general: null, period: null }))));
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('loads personal filters and resets unsaved drafts across funnels and users', async () => {
    vi.mocked(fetch).mockImplementation(async url => response({ general: { ...EMPTY_GENERAL, product: String(url).includes('/a/') ? 'product-a' : 'product-b' }, period: null }) as Response);
    const { result, rerender } = renderHook(({ user, board }) => useBoardFilters(user, 'org', board, 'open'), { initialProps: { user: 'user-a', board: 'a' }, wrapper: wrapper() });
    await waitFor(() => expect(result.current.general.product).toBe('product-a'));
    act(() => result.current.setGeneral({ product: 'unsaved' }));
    rerender({ user: 'user-a', board: 'b' });
    await waitFor(() => expect(result.current.general.product).toBe('product-b'));
    rerender({ user: 'user-a', board: 'a' });
    expect(result.current.general.product).toBe('product-a');
    rerender({ user: 'user-b', board: 'a' });
    expect(result.current.general.product).not.toBe('unsaved');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });
  it('does not overwrite early manual choices when the saved defaults arrive', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(r => { resolve = r; }) as Promise<Response>);
    const { result } = renderHook(() => useBoardFilters('u', 'o', 'b', 'open'), { wrapper: wrapper() });
    act(() => result.current.setGeneral({ status: 'lost' }));
    await act(async () => resolve(response({ general: { ...EMPTY_GENERAL, status: 'won' }, period: null })));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.general.status).toBe('lost');
  });
  it('pins only the selected group and restores it after remount', async () => {
    const saved = { general: { ...EMPTY_GENERAL, status: 'all' as const, product: 'one' }, period: { ...EMPTY_PERIOD, preset: 'lastMonth' as const } };
    vi.mocked(fetch).mockResolvedValue(response(saved) as Response);
    const wrap = wrapper();
    const first = renderHook(() => useBoardFilters('u', 'o', 'b', 'open'), { wrapper: wrap });
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    act(() => first.result.current.pin({ period: saved.period }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const init = vi.mocked(fetch).mock.calls[1][1];
    expect(JSON.parse(String(init?.body))).toEqual({ period: saved.period });
    await waitFor(() => expect(first.result.current.saving).toBe(false));
    first.unmount();
    const second = renderHook(() => useBoardFilters('u', 'o', 'b', 'open'), { wrapper: wrap });
    expect(second.result.current.general.product).toBe('one');
    expect(second.result.current.period.preset).toBe('lastMonth');
  });
  it('honors URL status over defaults, but allows a manual override', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ general: { ...EMPTY_GENERAL, status: 'won' }, period: null }) as Response);
    const { result } = renderHook(() => useBoardFilters('u', 'o', 'b', 'open', 'all'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.general.status).toBe('all');
    act(() => result.current.setGeneral({ status: 'lost' }));
    expect(result.current.general.status).toBe('lost');
  });
});
