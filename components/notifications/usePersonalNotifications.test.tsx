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

it('keeps an open connection incident visible and replaces it on recovery with personal alerts off', async () => {
  const incident: Notice = {...ordinary,id:'wa-line-open',kind:'alert',category:'connection_outage',title:'Falha na conexão do WhatsApp'};
  const restored: Notice = {...ordinary,id:'wa-line-recovered',kind:'alert',title:'WhatsApp reconectado'};
  feed={...feed,events:[incident]};
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.includes('preferences')
    ? {preferences:{...DEFAULT_PREFERENCES,alerts:false,messages:false,leads:false},boards:[]} : feed)));
  const {result}=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  expect(result.current.notices.map(n=>n.id)).toEqual([incident.id]);
  act(()=>result.current.clear());
  expect(result.current.notices.map(n=>n.id)).toEqual([incident.id]);
  feed={...feed,events:[restored]};
  // Avisos pessoais desligados: só os alertas de conexão, a cada 60 s
  await tick(59_000);
  expect(result.current.notices.map(n=>n.id)).toEqual([incident.id]);
  await tick(1_000);
  expect(result.current.notices.map(n=>n.id)).toEqual([restored.id]);
});

it('consulta a cada 15 s com a aba visível e 30 s com ela escondida, e na hora ao voltar', async () => {
  const fetchMock=vi.fn(async(url:string)=>Response.json(url.includes('preferences') ? {preferences:{...DEFAULT_PREFERENCES,messages:true},boards:[]} : {...feed,events:[]}));
  vi.stubGlobal('fetch',fetchMock);
  const events=()=>fetchMock.mock.calls.filter(([url])=>String(url).includes('/api/notifications/events')).length;
  renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  expect(events()).toBe(1);
  await tick(14_000);
  expect(events()).toBe(1);
  await tick(1_000);
  expect(events()).toBe(2);
  const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
  await tick(15_000);
  expect(events()).toBe(3);
  await tick(29_000);
  expect(events()).toBe(3);
  visibility.mockReturnValue('visible');
  await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
  await tick();
  expect(events()).toBe(4);
  visibility.mockRestore();
});

it('retains an unresolved block through clear, polling and outages; removes it only on a complete feed', async () => {
  const { result } = renderHook(() => usePersonalNotifications(), { wrapper });
  await tick();
  expect(result.current.notices.map(n => n.id).sort()).toEqual(['block', 'message']);
  act(() => result.current.clear());
  expect(result.current.notices.map(n => n.id)).toEqual(['block']);
  await tick(15_000);
  expect(result.current.notices.map(n => n.id)).toEqual(['block']);
  expect(h.deliver).toHaveBeenCalledTimes(2);
  feed = { ...feed, events: [], usageNoticesUnavailable: true };
  await tick(15_000);
  expect(result.current.notices.map(n => n.id)).toEqual(['block']);
  expect(result.current.error).toContain('temporariamente indisponíveis');
  feed = { ...feed, usageNoticesUnavailable: false };
  await tick(15_000);
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
