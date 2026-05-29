/* eslint-disable no-restricted-globals */
// Minimal Service Worker (MVP): cache app shell assets for faster launch.
// Note: This does NOT provide offline data sync.
//
// IMPORTANTE: O SW só faz cache de assets ESTÁTICOS. Requests de dados
// (Supabase REST, Auth, Realtime, /api/*, /_next/data/*) passam direto
// pra rede sempre — o stale-while-revalidate em endpoints de dados
// quebrava polling/refetch (TanStack Query recebia resposta cacheada
// e nunca atualizava a UI com leads novos).

const CACHE_NAME = 'nossocrm-shell-v3';
const SHELL_URLS = [
  '/',
  '/login',
  '/boards',
  '/inbox',
  '/contacts',
  '/activities',
  '/icons/icon.svg',
  '/icons/maskable.svg',
];

// Pathnames que NUNCA devem ser cacheados pelo SW (sempre network).
// Match por prefixo no pathname OU substring no host (Supabase está em
// outro domínio, então também precisa matchar pelo host).
const NEVER_CACHE_PATHNAMES = [
  '/api/',
  '/_next/data/',
];
const NEVER_CACHE_HOST_SUBSTRINGS = [
  'supabase.co',     // banco + auth + storage do Supabase
  'supabase.in',     // domínio alternativo Supabase
  'realtime',        // websocket realtime (já passa direto, mas redundância)
];

function shouldBypassCache(url) {
  try {
    const u = new URL(url);
    if (NEVER_CACHE_PATHNAMES.some((p) => u.pathname.startsWith(p))) return true;
    if (NEVER_CACHE_HOST_SUBSTRINGS.some((h) => u.hostname.includes(h))) return true;
    return false;
  } catch {
    return false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Bypass total para endpoints de dados — sempre rede, nunca cache.
  if (shouldBypassCache(req.url)) return;

  // Network-first for navigations, fallback to cache if offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Stale-while-revalidate APENAS para assets estáticos
  // (/_next/static/, /icons/, fonts, CSS, JS bundles do app shell).
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
