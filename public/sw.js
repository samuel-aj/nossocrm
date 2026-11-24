/* eslint-disable no-restricted-globals */
// Cache only static app assets. HTML, App Router/RSC and authenticated data
// must never survive a deployment in this cache.
const CACHE_NAME = 'nossocrm-shell-v4';
const OFFLINE_URL = '/offline.html';
const PUSH_CONSENT_CACHE = 'nossocrm-push-consent-v1';
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

function validPushScope(data) {
  return data?.kind === 'lead_message' && uuid.test(data.userId) && uuid.test(data.organizationId);
}
function deviceConsent(data) {
  return caches.match('/__push_consent/' + data.userId + '/' + data.organizationId, { cacheName: PUSH_CONSENT_CACHE });
}

// Some push providers renew endpoints while the CRM is closed. Restore only offices
// still registered on the old endpoint for the authenticated recipient of this device.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const prior = event.oldSubscription;
    if (!prior?.endpoint || !await caches.has(PUSH_CONSENT_CACHE)) return;
    const cache = await caches.open(PUSH_CONSENT_CACHE);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prior.endpoint));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    let replacement = event.newSubscription;
    for (const request of await cache.keys()) {
      const [, prefix, userId, organizationId] = new URL(request.url).pathname.split('/');
      if (prefix !== '__push_consent' || !uuid.test(userId) || !uuid.test(organizationId)) continue;
      const init = { credentials: 'same-origin', cache: 'no-store', headers: {
        'x-org-id': organizationId, 'x-push-user-id': userId, 'Content-Type': 'application/json',
      } };
      try {
        const response = await fetch('/api/notifications/push?device=' + hash, init);
        if (!response.ok) continue;
        const { enabled, publicKey } = await response.json();
        if (!enabled || !publicKey || !await cache.match(request)) continue;
        const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
        const currentKey = replacement?.options.applicationServerKey;
        if (replacement && (!currentKey || currentKey.byteLength !== key.length ||
          new Uint8Array(currentKey).some((byte, i) => byte !== key[i]))) {
          await replacement.unsubscribe();
          replacement = null;
        }
        if (!replacement) {
          replacement = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        }
        const added = await fetch('/api/notifications/push', { ...init, method: 'POST', body: JSON.stringify({ subscription: replacement.toJSON() }) });
        if (added.ok && !await cache.match(request)) {
          await fetch('/api/notifications/push', { ...init, method: 'DELETE', body: JSON.stringify({ endpoint: replacement.endpoint }) });
        }
        if (added.ok && replacement.endpoint !== prior.endpoint) {
          await fetch('/api/notifications/push', { ...init, method: 'DELETE', body: JSON.stringify({ endpoint: prior.endpoint }) });
        }
      } catch { /* A temporarily unavailable office must not prevent another office from renewing. */ }
    }
  })());
});
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    // A queued push for a signed-out person or disabled office is obsolete.
    if (!validPushScope(data) || !await deviceConsent(data)) return;
    const eventId = String(data.eventId ?? '');
    if (!/^[\w-]{1,80}$/.test(eventId)) return;
    await self.registration.showNotification('Nova mensagem no NossoCRM', {
      body: 'Abra o CRM para ler a mensagem.',
      tag: 'crm-message-' + data.organizationId + '-' + eventId,
      icon: '/icons/icon.svg',
      data: { kind: 'lead_message', userId: data.userId, organizationId: data.organizationId,
        conversationId: uuid.test(data.conversationId) ? data.conversationId : null },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    const target = new URL('/chats', self.location.origin);
    if (validPushScope(data) && uuid.test(data.conversationId) && await deviceConsent(data)) {
      target.searchParams.set('conversation', data.conversationId);
      target.searchParams.set('pushOrg', data.organizationId);
      target.searchParams.set('pushUser', data.userId);
    }
    // Open the originating office in its own context. Do not change a seller's other open office.
    await self.clients.openWindow(target.href);
  })());
});
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
