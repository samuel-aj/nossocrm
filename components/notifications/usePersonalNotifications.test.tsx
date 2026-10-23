import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, type Notice, type NotificationFeed } from '@/lib/notifications/types';

const h = vi.hoisted(() => ({ org: 'org-one', router: { push: vi.fn() }, deliver: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' }, organizationId: h.org }) }));
vi.mock('next/navigation', () => ({ useRouter: () => h.router }));
vi.mock('@/lib/notifications/delivery', () => ({
  deliverNotice: h.deliver, unlockNotificationSound: vi.fn(),
  presentOnce: async (_scope: string, _id: string, deliver: () => void) => deliver(),
}));
import { usePersonalNotifications } from './usePersonalNotifications';

const usage: Notice = { id: 'block', category: 'ai_usage', kind: 'alert', title: 'IA pausada por limite', message: 'Liberação manual', href: '/chats?conversation=c', createdAt: '2026-10-23T10:00:00Z' };
const ordinary: Notice = { ...usage, id: 'message', category: undefined, kind: 'message', title: 'Nova mensagem' };
let client: QueryClient;
let feed: NotificationFeed;
beforeEach(() => {
  vi.useFakeTimers(); h.org = 'org-one'; h.deliver.mockClear();
  feed = { events: [usage, ordinary], serverTime: '2026-10-23T10:00:01Z', nextAfter: null };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('preferences')
    ? { preferences: { ...DEFAULT_PREFERENCES, messages: true }, boards: [] } : feed)));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
async function tick(ms = 20) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

it('retains an unresolved block through clear, polling and outages; removes it only on a complete feed', async () => {
  const { result } = renderHook(() => usePersonalNotifications(), { wrapper });
  await tick();
  expect(result.current.notices.map(n => n.id).sort()).toEqual(['block', 'message']);
  act(() => result.current.clear());
  expect(result.current.notices.map(n => n.id)).toEqual(['block']);
  await tick(4000);
  expect(result.current.notices.map(n => n.id)).toEqual(['block']);
  expect(h.deliver).toHaveBeenCalledTimes(2);
  feed = { ...feed, events: [], usageNoticesUnavailable: true };
  await tick(4000);
  expect(result.current.notices.map(n => n.id)).toEqual(['block']);
  expect(result.current.error).toContain('temporariamente indisponíveis');
  feed = { ...feed, usageNoticesUnavailable: false };
  await tick(4000);
  expect(result.current.notices).toEqual([]);
  expect(result.current.error).toBe('');
});

it('does not retain another organization’s markers when the scope changes during an outage', async () => {
  const view = renderHook(() => usePersonalNotifications(), { wrapper });
  await tick();
  expect(view.result.current.notices).toHaveLength(2);
  h.org = 'org-two'; feed = { ...feed, events: [], usageNoticesUnavailable: true };
  view.rerender();
  expect(view.result.current.notices).toEqual([]);
  await tick();
  expect(view.result.current.notices).toEqual([]);
});
