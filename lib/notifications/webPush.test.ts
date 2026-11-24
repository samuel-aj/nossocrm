// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { deliverWebPush, isAllowedPushEndpoint, isValidPushKeys, readWebPushConfig, type PushMessage } from './webPush';

const browser = createECDH('prime256v1');
const vapid = createECDH('prime256v1');
browser.generateKeys();
vapid.generateKeys();
const device = { endpoint: 'https://fcm.googleapis.com/fcm/send/ficticio', p256dh: browser.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
const config = { publicKey: vapid.getPublicKey().toString('base64url'),
  privateKey: Buffer.from(vapid.getPrivateKey('hex').padStart(64, '0'), 'hex').toString('base64url'), subject: 'mailto:push@example.test' };
const message: PushMessage = { kind: 'lead_message', eventId: '42', organizationId: 'org', userId: 'user', conversationId: 'chat' };
const network = vi.fn<typeof fetch>();
const require = createRequire(import.meta.url);
const { decrypt } = createRequire(require.resolve('web-push'))('http_ece');

beforeEach(() => { network.mockReset(); vi.stubGlobal('fetch', network); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Web Push com provedor e aparelho simulados', () => {
  it.each([
    'https://web.push.apple.com/assinatura',
    'https://fcm.googleapis.com/wp/assinatura',
    'https://updates.push.services.mozilla.com/wpush/v2/assinatura',
  ])('o aparelho fictício consegue abrir a mensagem cifrada para %s', async endpoint => {
    network.mockResolvedValue(new Response(null, { status: 201 }));
    expect(await deliverWebPush({ ...device, endpoint }, message, config)).toBe('sent');
    const [url, options] = network.mock.calls[0];
    expect(url).toBe(endpoint);
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'omit' });
    const headers = new Headers(options?.headers);
    expect(headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(headers.get('TTL')).toBe('3600');
    expect(headers.get('Topic')).toHaveLength(32);
    const authorization = headers.get('Authorization')!;
    expect(authorization).toContain('k=' + config.publicKey);
    const claims = JSON.parse(Buffer.from(authorization.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ aud: new URL(endpoint).origin, sub: config.subject });
    const ciphertext = Buffer.from(options?.body as Uint8Array);
    expect(ciphertext.toString()).not.toContain('lead_message');
    expect(JSON.parse(decrypt(ciphertext, { version: 'aes128gcm', privateKey: browser,
      authSecret: Buffer.from(device.auth, 'base64url') }).toString())).toEqual(message);
  });

  it.each([
    'http://web.push.apple.com/token', 'https://web.push.apple.com.evil.test/token', 'https://127.0.0.1/token',
    'https://user@fcm.googleapis.com/fcm/send/token', 'https://fcm.googleapis.com:444/token',
    'https://fcm.googleapis.com/token#fragment', 'https://fcm.googleapis.com/', 'https://fcm.googleapis.com\\@example.test/x',
  ])('não faz requisição para um endpoint inválido', async endpoint => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
    expect(await deliverWebPush({ ...device, endpoint }, message, config)).toBe('gone');
    expect(network).not.toHaveBeenCalled();
  });

  it.each([[404, 'gone'], [410, 'gone'], [429, 'retry'], [503, 'retry'], [401, 'retry'], [302, 'skip'], [400, 'skip']])(
    'trata HTTP %s como %s', async (status, outcome) => {
      network.mockResolvedValue(new Response(null, { status: Number(status) }));
      expect(await deliverWebPush(device, message, config)).toBe(outcome);
      expect(network).toHaveBeenCalledTimes(1);
    });

  it('mantém o mesmo tópico do evento na reentrega após falha incerta', async () => {
    network.mockRejectedValueOnce(new Error('tempo excedido')).mockResolvedValueOnce(new Response(null, { status: 201 }));
    expect(await deliverWebPush(device, message, config)).toBe('retry');
    expect(await deliverWebPush(device, message, config)).toBe('sent');
    const topics = network.mock.calls.map(([, options]) => new Headers(options?.headers).get('Topic'));
    expect(topics[0]).toBeTruthy(); expect(topics[1]).toBe(topics[0]);
  });

  it('valida as chaves de inscrição do aparelho e o par VAPID do servidor', () => {
    expect(isValidPushKeys(device.p256dh, device.auth)).toBe(true);
    expect(isValidPushKeys(Buffer.alloc(65).toString('base64url'), device.auth)).toBe(false);
    vi.stubEnv('WEB_PUSH_VAPID_PUBLIC_KEY', config.publicKey);
    vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', config.privateKey);
    vi.stubEnv('WEB_PUSH_VAPID_SUBJECT', config.subject);
    expect(readWebPushConfig()).toEqual(config);
    vi.stubEnv('WEB_PUSH_VAPID_PUBLIC_KEY', device.p256dh);
    expect(readWebPushConfig()).toBeNull();
  });
});
