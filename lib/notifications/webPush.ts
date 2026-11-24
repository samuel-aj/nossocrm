import 'server-only';
import { createECDH, createHash, ECDH } from 'node:crypto';
import { generateRequestDetails } from 'web-push';

export type WebPushConfig = { publicKey: string; privateKey: string; subject: string };
export type DeviceSubscription = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = {
  kind: 'lead_message';
  eventId: string;
  organizationId: string;
  userId: string;
  conversationId: string;
};
export type PushOutcome = 'sent' | 'gone' | 'retry' | 'skip';

export function readWebPushConfig(): WebPushConfig | null {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !/^[\w-]{87}$/.test(publicKey) || !/^[\w-]{43}$/.test(privateKey)) return null;
  try {
    const contact = new URL(subject);
    if (!(contact.protocol === 'https:' && contact.hostname !== 'localhost') &&
        !(contact.protocol === 'mailto:' && /^[^@\s]+@[^@\s]+$/.test(contact.pathname))) return null;
    const pair = createECDH('prime256v1');
    pair.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (pair.getPublicKey().toString('base64url') !== publicKey) return null;
  } catch { return null; }
  return { publicKey, privateKey, subject };
}

/** Only send subscription traffic to browser push services, never arbitrary user URLs. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    if (endpoint.length > 2048 || /[\\\s]/.test(endpoint)) return false;
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.pathname === '/') return false;
    return url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com' ||
      url.hostname === 'push.apple.com' || url.hostname.endsWith('.push.apple.com');
  } catch { return false; }
}

export function isValidPushKeys(p256dh: string, auth: string): boolean {
  if (!/^[\w-]{87}$/.test(p256dh) || !/^[\w-]{22}$/.test(auth)) return false;
  try {
    const point = Buffer.from(p256dh, 'base64url');
    return Buffer.from(auth, 'base64url').toString('base64url') === auth && point[0] === 4 &&
      ECDH.convertKey(point, 'prime256v1', undefined, 'base64url', 'uncompressed') === p256dh;
  } catch { return false; }
}

/** The provider receives an authenticated RFC 8291 ciphertext, never lead details. */
export async function deliverWebPush(subscription: DeviceSubscription, message: PushMessage, config: WebPushConfig): Promise<PushOutcome> {
  if (!isAllowedPushEndpoint(subscription.endpoint) || !isValidPushKeys(subscription.p256dh, subscription.auth)) return 'gone';
  const topic = createHash('sha256').update(message.organizationId + ':' + message.eventId).digest('base64url').slice(0, 32);
  let request;
  try {
    request = generateRequestDetails({
      endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, JSON.stringify(message), {
      vapidDetails: config, TTL: 3600, urgency: 'high', topic, contentEncoding: 'aes128gcm',
    });
  } catch {
    return 'retry';
  }
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) headers.set(key, String(value));
    const response = await fetch(subscription.endpoint, {
      method: 'POST', headers, body: new Uint8Array(request.body), redirect: 'manual',
      cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8_000),
    });
    if (response.body) await response.body.cancel().catch(() => undefined);
    if (response.ok) return 'sent';
    if (response.status === 404 || response.status === 410) return 'gone';
    if ([401, 403, 408, 425, 429].includes(response.status) || response.status >= 500) return 'retry';
    return 'skip';
  } catch {
    // A timeout may follow provider acceptance. Topic and notification tag are
    // stable for this event so a later retry replaces the original notice.
    return 'retry';
  }
}
