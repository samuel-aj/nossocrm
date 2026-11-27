import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, type Notice, type NotificationFeed } from '@/lib/notifications/types';

const h = vi.hoisted(() => ({ org: 'org-one', router: { push: vi.fn() }, deliver: vi.fn(), receivesPush: vi.fn(), deliveryDelay:0 }));
vi.mock('@/lib/notifications/pushDevice', () => ({ receivesDevicePush: h.receivesPush }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' }, organizationId: h.org }) }));
vi.mock('next/navigation', () => ({ useRouter: () => h.router }));
vi.mock('@/lib/notifications/delivery', () => ({
  deliverNotice: h.deliver, unlockNotificationSound: vi.fn(),
  presentOnce: async (_scope: string, _id: string, deliver: () => void) => {
    if(h.deliveryDelay) await new Promise(resolve=>setTimeout(resolve,h.deliveryDelay));
    deliver();
  },
}));
import { usePersonalNotifications } from './usePersonalNotifications';

const usage: Notice = { id: 'block', category: 'ai_usage', kind: 'alert', title: 'IA pausada por limite', message: 'Liberação manual', href: '/chats?conversation=c', createdAt: '2026-10-23T10:00:00Z' };
const ordinary: Notice = { ...usage, id: 'message', category: undefined, kind: 'message', title: 'Nova mensagem' };
let client: QueryClient;
let feed: NotificationFeed;
beforeEach(() => {
  vi.useFakeTimers(); h.org = 'org-one'; h.deliver.mockClear(); h.deliveryDelay=0;
  vi.setSystemTime(new Date('2026-10-23T10:00:01Z'));
  h.receivesPush.mockResolvedValue(false);
  feed = { events: [usage, ordinary], serverTime: '2026-10-23T10:00:01Z', nextAfter: null };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('preferences')
    ? { preferences: { ...DEFAULT_PREFERENCES, messages: true }, boards: [] } : feed)));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
async function tick(ms = 20) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

it('keeps push-enabled messages in the bell without a second desktop or sound alert', async () => {
  h.receivesPush.mockResolvedValue(true);
  const { result } = renderHook(() => usePersonalNotifications(), { wrapper });
  await tick();
  expect(result.current.notices.map(n => n.id).sort()).toEqual(['block', 'message']);
  expect(h.receivesPush).toHaveBeenCalledWith({ userId: 'user', organizationId: 'org-one' });
  expect(h.deliver).toHaveBeenCalledTimes(1);
});

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
  await tick(60_000);
  expect(result.current.notices.map(n=>n.id)).toEqual([restored.id]);
});

it('retains an unresolved block through clear, polling and outages; removes it only on a complete feed', async () => {
  const { result } = renderHook(() => usePersonalNotifications(), { wrapper });
  await tick();
  expect(result.current.notices.map(n => n.id).sort()).toEqual(['block', 'message']);
  act(() => result.current.clear());
  expect(result.current.notices.map(n => n.id)).toEqual(['block']);
  await tick(60_000);
  expect(result.current.notices.map(n => n.id)).toEqual(['block']);
  expect(h.deliver).toHaveBeenCalledTimes(2);
  feed = { ...feed, events: [], usageNoticesUnavailable: true };
  await tick(60_000);
  expect(result.current.notices.map(n => n.id)).toEqual(['block']);
  expect(result.current.error).toContain('temporariamente indisponíveis');
  feed = { ...feed, usageNoticesUnavailable: false };
  await tick(60_000);
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

const callsFor = (path: string) => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes(path));

it('keeps one-minute polling without repeatedly fetching preferences or restarting on rerender', async () => {
  const view=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  expect(callsFor('/events')).toHaveLength(1);
  view.rerender();
  await tick(59_000);
  expect(callsFor('/events')).toHaveLength(1);
  await tick(1_000);
  expect(callsFor('/events')).toHaveLength(2);
  await tick(59*60_000);
  expect(callsFor('/events')).toHaveLength(61);
  expect(callsFor('/preferences')).toHaveLength(1);
});

it('coalesces bell/focus refreshes and uses the cached preferences', async () => {
  const {result}=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  await tick(16_000);
  act(()=>{result.current.refresh();window.dispatchEvent(new Event('focus'));result.current.refresh();});
  await tick();
  expect(callsFor('/events')).toHaveLength(2);
  expect(callsFor('/preferences')).toHaveLength(1);
});

it('keeps the cursor and seen notices when preferences change', async () => {
  const {result}=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  act(()=>client.setQueryData(['personal-notification-settings','org-one:user'],{
    preferences:{...DEFAULT_PREFERENCES,messages:true,sound:true},boards:[],
  }));
  await tick();
  expect(result.current.notices).toHaveLength(2);
  expect(h.deliver).toHaveBeenCalledTimes(2);
  const last=new URL(String(callsFor('/events').at(-1)![0]),'https://crm.test');
  expect(last.searchParams.get('since')).toBe('2026-10-23T10:00:01Z');
});

it('recovers notices after suspension using the previous cursor without replaying old sounds', async () => {
  const {result}=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  h.deliver.mockClear();
  vi.setSystemTime(new Date('2026-10-23T10:10:01Z'));
  feed={events:[usage,{...ordinary,id:'while-away',createdAt:'2026-10-23T10:04:00Z'},
    {...ordinary,id:'just-arrived',createdAt:'2026-10-23T10:10:00Z'}],serverTime:'2026-10-23T10:10:01Z',nextAfter:null};
  act(()=>result.current.refresh());
  await tick();
  expect(result.current.notices.map(n=>n.id)).toContain('while-away');
  expect(result.current.notices.map(n=>n.id)).toContain('just-arrived');
  expect(h.deliver).toHaveBeenCalledTimes(1);
  expect(h.deliver.mock.calls[0][0].id).toBe('just-arrived');
  expect(new URL(String(callsFor('/events').at(-1)![0]),'https://crm.test').searchParams.get('since')).toBe('2026-10-23T10:00:01Z');
});

it('keeps pagination in one batch and only advances the cursor after its last page', async () => {
  const {result}=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  const originalFetch=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url,init)=>{
    if(!String(url).includes('/events')) return originalFetch(url,init);
    const after=new URL(String(url),'https://crm.test').searchParams.get('after');
    return Response.json({events:[{...ordinary,id:after?'page-two':'page-one'}],
      serverTime:'2026-10-23T10:01:01Z',nextAfter:after?null:'200'});
  });
  await tick(60_000);
  const pages=callsFor('/events').slice(-2).map(([url])=>new URL(String(url),'https://crm.test'));
  expect(pages.map(q=>q.searchParams.get('since'))).toEqual(['2026-10-23T10:00:01Z','2026-10-23T10:00:01Z']);
  expect(pages[1].searchParams.get('until')).toBe('2026-10-23T10:01:01Z');
  expect(result.current.notices.map(n=>n.id)).toEqual(expect.arrayContaining(['page-one','page-two']));
});

it('aborts the previous organization request and discards its late response', async () => {
  let oldSignal:AbortSignal|undefined,resolveOld:((response:Response)=>void)|undefined;
  const originalFetch=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url,init)=>{
    if(h.org==='org-one' && String(url).includes('/events')) {
      oldSignal=init?.signal as AbortSignal;
      return new Promise<Response>(resolve=>{resolveOld=resolve;});
    }
    return originalFetch(url,init);
  });
  const view=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  h.org='org-two';feed={...feed,events:[]};
  view.rerender();
  await tick();
  expect(oldSignal?.aborted).toBe(true);
  await act(async()=>{resolveOld!(Response.json({...feed,events:[ordinary]}));});
  expect(view.result.current.notices).toEqual([]);
  expect(h.deliver).not.toHaveBeenCalled();
});

it('backs off when a projection is unavailable and retains unresolved alerts', async () => {
  const {result}=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  feed={...feed,events:[],connectionNoticesUnavailable:true};
  await tick(60_000);
  await tick(60_000);
  expect(callsFor('/events')).toHaveLength(3);
  act(()=>result.current.refresh());
  await tick(60_000);
  expect(callsFor('/events')).toHaveLength(3);
  expect(result.current.notices.map(n=>n.id)).toContain('block');
  expect(result.current.error).toContain('conexão');
  feed={...feed,connectionNoticesUnavailable:false};
  await tick(60_000);
  expect(callsFor('/events')).toHaveLength(4);
  expect(result.current.error).toBe('');
});

it('times out a stuck HTTP request and retries without overlapping calls', async () => {
  const originalFetch=vi.mocked(fetch).getMockImplementation()!;
  let pending=true;
  vi.mocked(fetch).mockImplementation((url,init)=>{
    if(pending && String(url).includes('/events')) return new Promise<Response>((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>reject(init.signal!.reason),{once:true});
    });
    return originalFetch(url,init);
  });
  const {result}=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  await tick(20_000);
  expect(result.current.error).toContain('temporariamente indisponíveis');
  expect(callsFor('/events')).toHaveLength(1);
  pending=false;
  await tick(60_000);
  expect(callsFor('/events')).toHaveLength(2);
  expect(result.current.error).toBe('');
});

it('finishes a healthy background batch whose local deliveries take over twenty seconds', async () => {
  vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
  feed={...feed,events:[]};
  const {result}=renderHook(()=>usePersonalNotifications(),{wrapper});
  await tick();
  h.deliveryDelay=350;
  feed={events:Array.from({length:60},(_,i)=>({...ordinary,id:`burst-${i}`,createdAt:'2026-10-23T10:01:00Z'})),
    serverTime:'2026-10-23T10:01:01Z',nextAfter:null};
  await tick(60_000);
  await tick(21_000);
  expect(h.deliver).toHaveBeenCalledTimes(60);
  expect(result.current.notices).toHaveLength(30);
  expect(result.current.error).toBe('');
  expect(callsFor('/events')).toHaveLength(2);
  h.deliveryDelay=0;feed={...feed,events:[],serverTime:'2026-10-23T10:02:22Z'};
  await tick(60_000);
  expect(new URL(String(callsFor('/events').at(-1)![0]),'https://crm.test').searchParams.get('since')).toBe('2026-10-23T10:01:01Z');
});
