// @vitest-environment node
import { createECDH, createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST, DELETE } from './route';

const h = vi.hoisted(() => ({ orgUser: vi.fn(), config: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: h.orgUser }));
vi.mock('@/lib/notifications/webPush', async original => ({
  ...await original<typeof import('@/lib/notifications/webPush')>(), readWebPushConfig: h.config,
}));
const endpoint = 'https://fcm.googleapis.com/fcm/send/example-subscription';
const hash = createHash('sha256').update(endpoint).digest('hex');
const p256dh = createECDH('prime256v1').generateKeys().toString('base64url');
const secret = randomBytes(16).toString('base64url');
const subscription = { endpoint, expirationTime: null, keys: { p256dh, auth: secret } };
function request(method: string, body?: unknown, query = '', headers: Record<string,string> = {}) {
  return new Request('https://crm.example.test/api/notifications/push' + query, { method,
    headers: { host: 'crm.example.test', 'x-forwarded-proto': 'https', 'x-push-user-id': 'seller', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const filters: Array<[string,string]> = [];
function subscriptionQuery() {
  const builder = { select: () => builder, delete: () => builder,
    eq: (key: string, value: string) => { filters.push([key,value]); return builder; },
    maybeSingle: async () => ({ data: { id: 'active' }, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
  };
  return builder;
}
beforeEach(() => {
  vi.resetAllMocks(); filters.length = 0;
  h.config.mockReturnValue({ publicKey: 'public', privateKey: 'never-expose' });
  h.rpc.mockResolvedValue({ error: null });
  h.from.mockImplementation(subscriptionQuery);
  h.orgUser.mockResolvedValue({ ok: true, admin: { from: h.from, rpc: h.rpc },
    user: { id: 'seller', organizationId: 'office', role: 'vendedor' } });
});
describe('cadastro do aparelho para notificações push', () => {
  it('consulta por hash e retorna somente a chave pública e o estado neste escritório', async () => {
    const res = await GET(request('GET', undefined, '?device=' + hash));
    expect(await res.json()).toEqual({ publicKey: 'public', enabled: true });
    expect(filters).toEqual([['organization_id','office'],['user_id','seller'],['endpoint_hash',hash]]);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
  it('não confunde serviço sem chave com aparelho ativado', async () => {
    h.config.mockReturnValue(null);
    expect(await (await GET(request('GET'))).json()).toEqual({ publicKey: null, enabled: false });
    expect((await POST(request('POST', { subscription }))).status).toBe(503);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('usa as chaves da inscrição nativa e a identidade autenticada', async () => {
    expect(await (await POST(request('POST', { subscription }))).json()).toEqual({ enabled: true });
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('register_crm_push_subscription', {
      p_org:'office', p_user:'seller', p_endpoint:endpoint, p_p256dh:p256dh, p_auth:secret,
    });
  });
  it.each([
    { subscription: { ...subscription, expirationTime: 1 } },
    { subscription: { ...subscription, endpoint: 'https://example.test/data' } },
    { subscription: { ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65,4).toString('base64url') } } },
    { subscription, organization_id: 'other' },
  ])('recusa inscrições inválidas antes de gravar', async body => {
    expect((await POST(request('POST', body))).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('recusa origem externa ou sessão que mudou de usuário', async () => {
    expect((await POST(request('POST',{subscription},'',{origin:'https://other.test'}))).status).toBe(403);
    expect((await DELETE(request('DELETE',{endpoint},'',{'x-push-user-id':'other'}))).status).toBe(409);
    expect(h.from).not.toHaveBeenCalled(); expect(h.rpc).not.toHaveBeenCalled();
  });
  it.each([false,true])('limita a desativação ao usuário e aparelho atuais (logout %s)', async allOrganizations => {
    expect((await DELETE(request('DELETE',{endpoint,allOrganizations}))).status).toBe(200);
    expect(filters).toContainEqual(['user_id','seller']);
    expect(filters).toContainEqual(['endpoint_hash',hash]);
    expect(filters.some(([key])=>key==='organization_id')).toBe(!allOrganizations);
  });
});
