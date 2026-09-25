/* eslint-disable no-restricted-globals */
// Cache only static app assets. HTML, App Router/RSC and authenticated data
// must never survive a deployment in this cache.
const CACHE_NAME = 'nossocrm-shell-v4';
const OFFLINE_URL = '/offline.html';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('nossocrm-shell-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () =>
      (await caches.match(OFFLINE_URL)) || Response.error()));
    return;
  }
  // Explicit allowlist excludes route prefetches, API avatars and signed media.
  if (!url.pathname.startsWith('/_next/static/') || url.searchParams.has('_rsc') || req.headers.get('RSC')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    const response = await fetch(req);
    if (response.ok && response.type === 'basic' && !response.redirected) {
      const copy = response.clone();
      event.waitUntil(cache.put(req, copy).catch(() => {}));
    }
    return response;
  })());
});
