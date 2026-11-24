// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker() {
  const listeners: Record<string, (e: any) => void> = {};
  const cache = { add: vi.fn(), put: vi.fn().mockResolvedValue(undefined), match: vi.fn(), keys: vi.fn() };
  const caches = { has: vi.fn(), open: vi.fn().mockResolvedValue(cache), match: vi.fn(), keys: vi.fn().mockResolvedValue(['nossocrm-shell-v3', 'nossocrm-shell-v4', 'another-app']), delete: vi.fn() };
  const fetch = vi.fn();
  const showNotification = vi.fn(), openWindow = vi.fn();
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self: { location: { origin: 'https://crm.test' }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; }, registration: { showNotification }, clients: { claim: vi.fn(), openWindow }, skipWaiting: vi.fn() }, crypto: webcrypto, TextEncoder, Uint8Array, atob, caches, fetch, URL, Response });
  function request(path: string, options = {}) {
    const event = { request: { method: 'GET', mode: 'cors', headers: new Headers(), url: new URL(path, 'https://crm.test').href, ...options }, respondWith: vi.fn(), waitUntil: vi.fn() };
    listeners.fetch(event);
    return event;
  }
  async function dispatch(name: string, properties: Record<string, unknown>) {
    const waitUntil = vi.fn();
    listeners[name]({ ...properties, waitUntil });
    await waitUntil.mock.calls[0][0];
  }
  return { listeners, caches, cache, fetch, request, dispatch, showNotification, openWindow };
}

const payload = {
  kind: 'lead_message', eventId: '124',
  userId: '44444444-4444-4444-8444-444444444444', organizationId: '11111111-1111-4111-8111-111111111111',
  conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
it('restores a provider-renewed endpoint only after the server confirms the original enrollment', async () => {
  const w = worker();
  w.caches.has.mockResolvedValue(true);
  const marker = { url: 'https://crm.test/__push_consent/' + payload.userId + '/' + payload.organizationId };
  w.cache.keys.mockResolvedValue([marker]);
  w.cache.match.mockResolvedValue(new Response('1'));
  const prior = { endpoint: 'https://push.example.invalid/old' };
  const event = { oldSubscription: prior, newSubscription: { endpoint: 'https://push.example.invalid/new', options: { applicationServerKey: new Uint8Array([1,2,3]).buffer }, toJSON: () => ({ endpoint: 'https://push.example.invalid/new', keys: {} }) } };
  w.fetch.mockResolvedValueOnce(Response.json({ enabled: false }));
  await w.dispatch('pushsubscriptionchange', event);
  expect(w.fetch).toHaveBeenCalledTimes(1);
  w.fetch.mockClear().mockResolvedValueOnce(Response.json({ enabled: true, publicKey: 'AQID' })).mockResolvedValueOnce(Response.json({ enabled: true })).mockResolvedValueOnce(Response.json({ enabled: false }));
  await w.dispatch('pushsubscriptionchange', event);
  const hash = createHash('sha256').update(prior.endpoint).digest('hex');
  expect(w.fetch).toHaveBeenNthCalledWith(1, '/api/notifications/push?device=' + hash, expect.objectContaining({ headers: expect.objectContaining({ 'x-org-id': payload.organizationId, 'x-push-user-id': payload.userId }) }));
  expect(w.fetch).toHaveBeenNthCalledWith(2, '/api/notifications/push', expect.objectContaining({ method: 'POST' }));
  expect(w.fetch).toHaveBeenNthCalledWith(3, '/api/notifications/push', expect.objectContaining({ method: 'DELETE', body: JSON.stringify(prior) }));
});
it('shows a generic notification with no CRM window or network, for an opted-in office', async () => {
  const w = worker();
  w.caches.match.mockResolvedValue(new Response('1'));
  await w.dispatch('push', { data: { json: () => ({ ...payload, title: 'private name', body: 'private text', href: 'https://outside.test' }) } });
  expect(w.caches.match).toHaveBeenCalledWith('/__push_consent/' + payload.userId + '/' + payload.organizationId, { cacheName: 'nossocrm-push-consent-v1' });
  expect(w.showNotification).toHaveBeenCalledWith('Nova mensagem no NossoCRM', {
    body: 'Abra o CRM para ler a mensagem.', tag: 'crm-message-' + payload.organizationId + '-124',
    icon: expect.any(String), data: { kind: payload.kind, userId: payload.userId, organizationId: payload.organizationId, conversationId: payload.conversationId },
  });
  expect(w.fetch).not.toHaveBeenCalled();
});
it('ignores malformed envelopes and pending pushes after the device opts out or signs out', async () => {
  const w = worker();
  await w.dispatch('push', { data: { json: () => payload } });
  w.caches.match.mockResolvedValue(new Response('1'));
  await w.dispatch('push', { data: { json: () => { throw Error('invalid JSON'); } } });
  for (const fields of [{ kind: 'alert' }, { organizationId: '../../outside' }, { userId: null }, { eventId: '<invalid>' }]) {
    await w.dispatch('push', { data: { json: () => ({ ...payload, ...fields }) } });
  }
  expect(w.showNotification).not.toHaveBeenCalled();
});
it('opens only the same-origin conversation and drops stale or invalid conversation links', async () => {
  const w = worker(), close = vi.fn();
  w.caches.match.mockResolvedValueOnce(new Response('1'));
  const data = { ...payload, href: 'https://outside.test' };
  await w.dispatch('notificationclick', { notification: { data, close } });
  expect(w.openWindow).toHaveBeenLastCalledWith('https://crm.test/chats?conversation=' + payload.conversationId + '&pushOrg=' + payload.organizationId + '&pushUser=' + payload.userId);
  await w.dispatch('notificationclick', { notification: { data, close } });
  expect(w.openWindow).toHaveBeenLastCalledWith('https://crm.test/chats');
  await w.dispatch('notificationclick', { notification: { data: { ...data, conversationId: '//outside.test' }, close } });
  expect(w.openWindow).toHaveBeenLastCalledWith('https://crm.test/chats');
  expect(close).toHaveBeenCalledTimes(3);
});
it('never intercepts RSC, APIs, signed media, Supabase or external assets', () => {
  const w = worker();
  for (const url of ['/boards?_rsc=123', '/api/whatsapp/conversations', '/api/whatsapp/avatars/id', 'https://x.supabase.co/storage/a', 'https://cdn.test/a.js']) expect(w.request(url).respondWith).not.toHaveBeenCalled();
  expect(w.request('/_next/static/a.js', { headers: new Headers({ RSC: '1' }) }).respondWith).not.toHaveBeenCalled();
});
it('uses network HTML and a neutral offline page, never a previous authenticated page', async () => {
  const w = worker();
  w.fetch.mockResolvedValueOnce(new Response('new HTML'));
  const event = w.request('/boards', { mode: 'navigate' });
  expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe('new HTML');
  expect(w.cache.put).not.toHaveBeenCalled();
  w.fetch.mockRejectedValueOnce(new Error('offline')); w.caches.match.mockResolvedValue(new Response('offline'));
  const offline = w.request('/boards', { mode: 'navigate' });
  expect(await (await offline.respondWith.mock.calls[0][0]).text()).toBe('offline');
  expect(w.caches.match).toHaveBeenCalledWith('/offline.html');
});
it('reuses immutable chunks without re-downloading and never caches 404s', async () => {
  const w = worker(); w.cache.match.mockResolvedValueOnce(new Response('chunk'));
  expect(await (await w.request('/_next/static/chunk.js').respondWith.mock.calls[0][0]).text()).toBe('chunk');
  expect(w.fetch).not.toHaveBeenCalled();
  w.fetch.mockResolvedValueOnce(new Response('missing', { status: 404 }));
  await w.request('/_next/static/missing.js').respondWith.mock.calls[0][0];
  expect(w.cache.put).not.toHaveBeenCalled();
});
it('removes only obsolete CRM shell caches', async () => {
  const w = worker(); const event = { waitUntil: vi.fn() }; w.listeners.activate(event);
  await event.waitUntil.mock.calls[0][0];
  expect(w.caches.delete.mock.calls).toEqual([['nossocrm-shell-v3']]);
});
