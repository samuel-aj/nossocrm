import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readTabOrg } from '@/lib/tabOrg';
import { clearOtherPushConsents, disablePushDevice, enablePushDevice, openPushScope, pushSupport, readPushDevice, receivesDevicePush, refreshExistingPush, revokePushOnLogout } from './pushDevice';

const scope = { userId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' };
const second = { ...scope, organizationId: '33333333-3333-4333-8333-333333333333' };
const conversation = '44444444-4444-4444-8444-444444444444';
const endpoint = 'https://push.example.invalid/fake-endpoint';
function device() {
  const response = { enabled: true, publicKey: 'AQID' };
  const api = vi.fn(async (_url: string, _init: RequestInit) => Response.json(response));
  const subscription = { endpoint, options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer }, toJSON: () => ({ endpoint, keys: { auth: 'fake', p256dh: 'fake' } }), unsubscribe: vi.fn().mockResolvedValue(true) };
  const manager = { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe: vi.fn().mockResolvedValue(subscription) };
  const registration = { active: true, pushManager: manager, getNotifications: vi.fn().mockResolvedValue([]) };
  const permission = { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') };
  const markers = new Map<string, string>();
  const path = (input: string | Request) => new URL(typeof input === 'string' ? input : input.url, 'https://crm.test').pathname;
  const cache = {
    put: async (key: string, value: Response) => { markers.set(path(key), await value.text()); },
    delete: async (key: string | Request) => markers.delete(path(key)),
    keys: async () => Array.from(markers.keys(), key => ({ url: 'https://crm.test' + key })),
  };
  vi.stubGlobal('fetch', api);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Notification', permission);
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('caches', { open: async () => cache, has: async () => true, match: async (key: string) => markers.has(path(key)) ? new Response(markers.get(path(key))) : undefined });
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration }, userAgent: 'Android' });
  return { subscription, manager, registration, permission, markers, api };
}
beforeEach(() => { window.sessionStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('requests permission on the gesture and posts only the selected device, user and office', async () => {
  const f = device(); await clearOtherPushConsents(scope.userId);
  f.permission.permission = 'default'; f.manager.getSubscription.mockResolvedValueOnce(null);
  const enabling = enablePushDevice(scope, 'AQID');
  expect(f.permission.requestPermission).toHaveBeenCalledTimes(1);
  await enabling;
  expect(f.manager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) });
  expect(f.api).toHaveBeenCalledWith('/api/notifications/push', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ subscription: f.subscription.toJSON() }), headers: expect.objectContaining({ 'x-org-id': scope.organizationId, 'x-push-user-id': scope.userId }),
  }));
  expect(f.markers.size).toBe(1);
});
it('returns the server status using a hash and keeps the actual endpoint out of the URL', async () => {
  const f = device(); await clearOtherPushConsents(scope.userId);
  await readPushDevice(scope);
  const key = createHash('sha256').update(endpoint).digest('hex');
  expect(f.api.mock.calls[0][0]).toBe('/api/notifications/push?device=' + key);
  expect(await receivesDevicePush(scope)).toBe(true);
  expect(await receivesDevicePush(second)).toBe(false);
});
it('never registers a device after permission is refused', async () => {
  const f = device(); await clearOtherPushConsents(scope.userId);
  f.permission.permission = 'default'; f.permission.requestPermission.mockResolvedValueOnce('denied');
  await expect(enablePushDevice(scope, 'AQID')).rejects.toThrow('Autorize');
  expect(f.manager.subscribe).not.toHaveBeenCalled();
  expect(f.api).not.toHaveBeenCalled();
});
it('repairs a browser-renewed endpoint on return only when the old enrollment is still authorized', async () => {
  const f = device(); await clearOtherPushConsents(scope.userId);
  await enablePushDevice(scope, 'AQID');
  const nextEndpoint = endpoint + '-renewed';
  f.manager.getSubscription.mockResolvedValueOnce({ ...f.subscription, endpoint: nextEndpoint, toJSON: () => ({ endpoint: nextEndpoint }) });
  f.api.mockClear().mockResolvedValueOnce(Response.json({ enabled: false, publicKey: 'AQID' })).mockResolvedValueOnce(Response.json({ enabled: true, publicKey: 'AQID' }));
  await refreshExistingPush(scope, new AbortController().signal);
  expect(f.api.mock.calls.map(([url, init])=>[url,init.method || 'GET'])).toEqual([
    ['/api/notifications/push?device='+createHash('sha256').update(nextEndpoint).digest('hex'), 'GET'],
    ['/api/notifications/push?device='+createHash('sha256').update(endpoint).digest('hex'), 'GET'],
    ['/api/notifications/push','POST'],
  ]);
  f.api.mockClear();
  await refreshExistingPush(second, new AbortController().signal);
  expect(f.api).not.toHaveBeenCalled();
});
it('recovers after a VAPID key rotation, including the other subscribed office', async () => {
  const f = device(); await clearOtherPushConsents(scope.userId);
  await enablePushDevice(second, 'AQID');
  f.subscription.options.applicationServerKey = new Uint8Array([9, 8, 7]).buffer;
  expect(await readPushDevice(scope)).toMatchObject({ enabled: false, publicKey: 'AQID' });
  expect(await receivesDevicePush(scope)).toBe(false);
  const newEndpoint = endpoint + '-replacement';
  f.manager.subscribe.mockResolvedValue({ ...f.subscription, endpoint: newEndpoint, toJSON: () => ({ endpoint: newEndpoint }) });
  await enablePushDevice(scope, 'AQID');
  expect(f.subscription.unsubscribe).toHaveBeenCalledTimes(1);
  const targets = f.api.mock.calls.filter(([, init]) => init.method === 'POST' && String(init.body).includes(newEndpoint));
  expect(targets.map(([, init]) => new Headers(init.headers).get('x-org-id')).sort()).toEqual([scope.organizationId, second.organizationId].sort());
  expect(await receivesDevicePush(scope)).toBe(true);
  expect(await receivesDevicePush(second)).toBe(true);
});
it('turns off one office without disabling the other, then revokes the endpoint on logout', async () => {
  const f = device(); await clearOtherPushConsents(scope.userId);
  await enablePushDevice(scope, 'AQID'); await enablePushDevice(second, 'AQID');
  await disablePushDevice(scope);
  expect(await receivesDevicePush(scope)).toBe(false);
  expect(await receivesDevicePush(second)).toBe(true);
  expect(f.api.mock.calls[2][1].body).toBe(JSON.stringify({ endpoint }));
  expect(f.subscription.unsubscribe).not.toHaveBeenCalled();
  await revokePushOnLogout(second);
  expect(f.subscription.unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.api.mock.calls[3][1].body).toBe(JSON.stringify({ endpoint, allOrganizations: true }));
  expect(await receivesDevicePush(second)).toBe(false);
});
it('explains installation before permission on iOS and supports a home-screen app', () => {
  device();
  const apple = { ...navigator, userAgent: 'iPhone', standalone: false, serviceWorker: navigator.serviceWorker };
  vi.stubGlobal('navigator', apple);
  expect(pushSupport()).toBe('install-ios');
  apple.standalone = true;
  expect(pushSupport()).toBe('ready');
});
it('pins only the signed-in recipient’s office and removes the conversation for another login', () => {
  const link = '/chats?conversation=' + conversation + '&pushOrg=' + scope.organizationId + '&pushUser=' + scope.userId;
  window.history.replaceState(null, '', link); openPushScope(scope.userId);
  expect(readTabOrg()?.id).toBe(scope.organizationId);
  expect(window.location.search).toBe('?conversation=' + conversation);
  window.sessionStorage.clear();
  window.history.replaceState(null, '', link); openPushScope('another-person');
  expect(readTabOrg()).toBe(null);
  expect(window.location.search).toBe('');
});
