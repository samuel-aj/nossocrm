import { pinTabOrg } from '@/lib/tabOrg';

export type PushScope = { organizationId: string; userId: string };
export type PushDeviceStatus = { enabled: boolean; publicKey: string | null };
const endpoint = '/api/notifications/push';
// The service worker also reads these markers. They contain no message or subscription keys.
const consentCache = 'nossocrm-push-consent-v1';
const consentPath = (scope: PushScope) => '/__push_consent/' + scope.userId + '/' + scope.organizationId;
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
let currentUser: string | null | undefined;

export function pushSupport(): 'ready' | 'install-ios' | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported';
  const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !(navigator as Navigator & {standalone?: boolean}).standalone && !window.matchMedia?.('(display-mode: standalone)').matches) return 'install-ios';
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window &&
    'Notification' in window && 'caches' in window ? 'ready' : 'unsupported';
}

async function pushApi<T>(scope: PushScope, suffix = '', init: RequestInit = {}): Promise<T> {
  const response = await fetch(endpoint + suffix, {
    cache: 'no-store', ...init, headers: {
      'Content-Type': 'application/json', 'x-org-id': scope.organizationId, 'x-push-user-id': scope.userId,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Não foi possível atualizar os avisos deste aparelho.');
  return body as T;
}

async function deviceHash(endpointUrl: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpointUrl));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function serverKey(encoded: string) {
  return Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

function differentKey(sub: PushSubscription, publicKey: string) {
  const existing = sub.options.applicationServerKey;
  if (!existing) return true;
  const bytes = new Uint8Array(existing), desired = serverKey(publicKey);
  return bytes.length !== desired.length || bytes.some((byte, index) => byte !== desired[index]);
}

async function markEnabled(scope: PushScope, enabled: boolean | 'renew', hash = '') {
  const cache = await caches.open(consentCache);
  if (enabled) {
    if (currentUser !== undefined && currentUser !== scope.userId) return;
    await cache.put(consentPath(scope), new Response((enabled === 'renew' ? 'renew:' : 'active:') + hash));
    if (currentUser === undefined || currentUser === scope.userId) return;
  }
  await cache.delete(consentPath(scope));
}

export async function receivesDevicePush(scope: PushScope) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || typeof caches === 'undefined') return false;
  const marker = await caches.match(consentPath(scope), { cacheName: consentCache }).catch(() => undefined);
  return marker ? (await marker.text()).startsWith('active:') : false;
}

export async function readPushDevice(scope: PushScope, signal?: AbortSignal) {
  const registration = await navigator.serviceWorker.getRegistration();
  const sub = await registration?.pushManager.getSubscription();
  const hash = sub ? await deviceHash(sub.endpoint) : '';
  const suffix = sub ? '?device=' + hash : '';
  const status = await pushApi<PushDeviceStatus>(scope, suffix, { signal });
  if (status.enabled && sub && status.publicKey && differentKey(sub, status.publicKey)) {
    // Old VAPID subscriptions still have a server row but cannot receive a push signed by the new key.
    if (!signal?.aborted) await markEnabled(scope, 'renew', hash);
    return { ...status, enabled: false };
  }
  if (!signal?.aborted && sub && !status.enabled && status.publicKey && !differentKey(sub, status.publicKey)) {
    // Browsers may rotate endpoints without delivering pushsubscriptionchange.
    const marker = await caches.match(consentPath(scope), { cacheName: consentCache });
    const previousHash = (await marker?.text())?.split(':')[1];
    if (previousHash && previousHash !== hash && /^[a-f0-9]{64}$/.test(previousHash)) {
      const previous = await pushApi<PushDeviceStatus>(scope, '?device=' + previousHash, { signal });
      if (previous.enabled && !signal?.aborted && await caches.match(consentPath(scope), { cacheName: consentCache })) {
        await registerDevice(scope, sub);
        return { ...status, enabled: true };
      }
    }
  }
  if (!signal?.aborted) await markEnabled(scope, status.enabled, hash);
  return status;
}

export async function refreshExistingPush(scope: PushScope, signal: AbortSignal) {
  if (pushSupport() !== 'ready' || Notification.permission !== 'granted') return;
  if (await caches.match(consentPath(scope), { cacheName: consentCache }) && !signal.aborted) await readPushDevice(scope, signal);
}

async function otherDeviceScopes(scope: PushScope) {
  const cache = await caches.open(consentCache);
  const prefix = '/__push_consent/' + scope.userId + '/';
  return (await cache.keys()).map(k => new URL(k.url).pathname)
    .filter(path => path.startsWith(prefix))
    .map(path => path.slice(prefix.length))
    .filter(org => uuid.test(org) && org !== scope.organizationId)
    .map(organizationId => ({ userId: scope.userId, organizationId }));
}

async function registerDevice(scope: PushScope, sub: PushSubscription) {
  await pushApi(scope, '', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
  await markEnabled(scope, true, await deviceHash(sub.endpoint));
}

async function getActiveRegistration() {
  const registered = await navigator.serviceWorker.getRegistration() ?? await navigator.serviceWorker.register('/sw.js');
  if (registered.active) return registered;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('A instalação do aplicativo ainda não terminou. Abra-o novamente e tente ativar os avisos.')), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function enablePushDevice(scope: PushScope, publicKey: string) {
  // iOS requires the permission request directly in the user's click handler.
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Autorize as notificações para o CRM nas configurações do aparelho.');
  const registration = await getActiveRegistration();
  const prior = await registration.pushManager.getSubscription();
  if (prior && !differentKey(prior, publicKey)) return registerDevice(scope, prior);
  // One browser subscription serves every office this user has enabled on this device.
  const offices = prior ? await otherDeviceScopes(scope) : [];
  const oldHash = prior ? await deviceHash(prior.endpoint) : null;
  if (prior) await prior.unsubscribe();
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey(publicKey) });
  await registerDevice(scope, subscription);
  if (!prior) return;
  const removeOld = (office: PushScope) => prior.endpoint !== subscription.endpoint
    ? pushApi(office, '', { method: 'DELETE', body: JSON.stringify({ endpoint: prior.endpoint }) }) : Promise.resolve();
  await Promise.allSettled([removeOld(scope), ...offices.map(async office => {
    const status = await pushApi<PushDeviceStatus>(office, '?device=' + oldHash);
    if (!status.enabled || !await caches.match(consentPath(office), { cacheName: consentCache })) return;
    await registerDevice(office, subscription);
    await removeOld(office);
  })]);
}

export async function disablePushDevice(scope: PushScope) {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await pushApi(scope, '', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  await markEnabled(scope, false);
  // A single endpoint may also receive alerts for another explicitly enabled office.
  const notices = await registration?.getNotifications?.() ?? [];
  for (const notice of notices) {
    if (notice.data?.userId === scope.userId && notice.data?.organizationId === scope.organizationId) notice.close();
  }
}

export async function clearOtherPushConsents(userId: string | null) {
  currentUser = userId;
  if (typeof caches === 'undefined' || !await caches.has(consentCache)) return;
  const cache = await caches.open(consentCache);
  const old = (await cache.keys()).filter(request => new URL(request.url).pathname.split('/')[2] !== userId);
  if (currentUser !== userId) return;
  await Promise.all(old.map(request => cache.delete(request)));
  if (old.length && 'serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    const notices = await registration?.getNotifications?.() ?? [];
    for (const notice of notices) if (notice.data?.userId && notice.data.userId !== userId) notice.close();
  }
}

export async function revokePushOnLogout(scope: PushScope) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([revokeDevice(scope), new Promise<void>(resolve => { timer = setTimeout(resolve, 4000); })]);
  } finally { clearTimeout(timer); }
}

async function revokeDevice(scope: PushScope) {
  const cleared = clearOtherPushConsents(null);
  if (!('serviceWorker' in navigator)) return cleared;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return cleared;
  await Promise.allSettled([
    cleared, subscription.unsubscribe(),
    pushApi(scope, '', { method: 'DELETE', signal: AbortSignal.timeout(3500), body: JSON.stringify({ endpoint: subscription.endpoint, allOrganizations: true }) }),
  ]);
}

/** Pin only this tab; the existing profile loader revalidates membership before serving data. */
export function openPushScope(userId: string) {
  const url = new URL(window.location.href);
  if (url.pathname !== '/chats' || !url.searchParams.has('pushOrg')) return;
  const org = url.searchParams.get('pushOrg') ?? '';
  if (uuid.test(org) && url.searchParams.get('pushUser') === userId && uuid.test(url.searchParams.get('conversation') ?? '')) pinTabOrg(org);
  else url.searchParams.delete('conversation');
  url.searchParams.delete('pushOrg');
  url.searchParams.delete('pushUser');
  window.history.replaceState(window.history.state, '', url.pathname + url.search);
}
