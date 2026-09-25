// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker() {
  const listeners: Record<string, (e: any) => void> = {};
  const cache = { add: vi.fn(), put: vi.fn().mockResolvedValue(undefined), match: vi.fn() };
  const caches = { open: vi.fn().mockResolvedValue(cache), match: vi.fn(), keys: vi.fn().mockResolvedValue(['nossocrm-shell-v3', 'nossocrm-shell-v4', 'another-app']), delete: vi.fn() };
  const fetch = vi.fn();
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self: { location: { origin: 'https://crm.test' }, addEventListener: (name: string, fn: any) => { listeners[name] = fn; }, clients: { claim: vi.fn() }, skipWaiting: vi.fn() }, caches, fetch, URL, Response });
  function request(path: string, options = {}) {
    const event = { request: { method: 'GET', mode: 'cors', headers: new Headers(), url: new URL(path, 'https://crm.test').href, ...options }, respondWith: vi.fn(), waitUntil: vi.fn() };
    listeners.fetch(event);
    return event;
  }
  return { listeners, caches, cache, fetch, request };
}
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
