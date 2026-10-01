import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), byId: vi.fn(), all: vi.fn(), start: vi.fn(), status: vi.fn(), duplicate: vi.fn(), ensure: vi.fn(), save: vi.fn(), webhook: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({
  requireOrgUser: mocks.auth, isOrgAdmin: (role: string) => ['admin', 'super_admin'].includes(role),
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionByIdForOrg: mocks.byId, getConnectionsByOrg: mocks.all, upsertConnection: mocks.save }));
vi.mock('@/lib/whatsapp/admin', () => ({ ensureEvolutionInstance: mocks.ensure, registerWebhook: mocks.webhook }));
vi.mock('@/lib/whatsapp', () => ({
  getProvider: () => ({ startPairing: mocks.start, getPairingStatus: mocks.status }),
  envEvolution: () => ({ baseUrl: 'https://evo.test' }),
  isBusinessConnection: (row: { provider: string }) => ['meta_cloud', 'evolution_business'].includes(row.provider),
}));
vi.mock('@/lib/whatsapp/dedupe', () => ({ findConnectedSameNumber: mocks.duplicate }));
import { GET, POST } from './route';
import { PairingInstanceMissingError } from '@/lib/whatsapp/pairing';

const id = '11111111-1111-4111-8111-111111111111';
const conn = { id, provider: 'evolution' };
const post = (body: unknown) => POST(new Request('https://crm.test/api/whatsapp/connection/pair', { method: 'POST', body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'user', role: 'admin', organizationId: 'org-a' }, admin: 'admin-client' });
  mocks.byId.mockResolvedValue(conn); mocks.all.mockResolvedValue([conn]); mocks.duplicate.mockReturnValue(null);
  mocks.start.mockResolvedValue({ state: 'connecting', pairingCode: 'ABCD2345' });
  mocks.status.mockResolvedValue({ state: 'disconnected' });
});
describe('pairing authorization and contract', () => {
  it('requires authentication and an administrator', async () => {
    mocks.auth.mockResolvedValueOnce({ ok: false, response: new Response('', { status: 401 }) });
    expect((await post({ id, method: 'qr' })).status).toBe(401);
    mocks.auth.mockResolvedValueOnce({ ok: true, user: { role: 'sales', organizationId: 'org-a' } });
    expect((await post({ id, method: 'qr' })).status).toBe(403);
    expect(mocks.byId).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it('looks up the exact connection within the authenticated organization', async () => {
    mocks.byId.mockResolvedValue(null);
    expect((await post({ id, method: 'code', phone: '5511999990000' })).status).toBe(404);
    expect(mocks.byId).toHaveBeenCalledWith('admin-client', 'org-a', id);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(['meta_cloud', 'evolution_business'])('rejects %s connections', async provider => {
    mocks.byId.mockResolvedValue({ ...conn, provider });
    expect((await post({ id, method: 'qr' })).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([null, {}, { id, method: 'bad' }, { id, method: 'code', phone: '123' }])('rejects invalid payload %j', async body => {
    expect((await post(body)).status).toBe(400); expect(mocks.start).not.toHaveBeenCalled();
  });
  it('normalizes the phone and never caches the secret code', async () => {
    const result = await post({ id, method: 'code', phone: '+55 (11) 99999-0000' });
    expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.start).toHaveBeenCalledWith('5511999990000');
  });
  it('blocks duplicate connected numbers', async () => {
    mocks.duplicate.mockReturnValue({ id: 'another' });
    expect((await post({ id, method: 'code', phone: '5511999990000' })).status).toBe(409);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('polling only reads the existing attempt', async () => {
    const result = await GET(new Request(`https://crm.test/api/whatsapp/connection/pair?id=${id}`));
    expect(await result.json()).toEqual({ state: 'disconnected' });
    expect(result.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('hides network/provider internals', async () => {
    mocks.start.mockRejectedValue(new Error('https://secret.internal/key=private'));
    const result = await post({ id, method: 'qr' });
    expect(result.status).toBe(502); expect(await result.text()).not.toContain('secret.internal');
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
  it('recovers a missing instance and registers the webhook before retrying', async () => {
    mocks.byId.mockResolvedValue({ ...conn, instance_name: 'test-a', base_url: 'https://evo.test' });
    mocks.start.mockRejectedValueOnce(new PairingInstanceMissingError());
    mocks.ensure.mockResolvedValue({ token: 'new-token' }); mocks.save.mockResolvedValue(conn);
    expect((await post({ id, method: 'qr' })).status).toBe(200);
    expect(mocks.ensure).toHaveBeenCalledWith('test-a'); expect(mocks.webhook).toHaveBeenCalledWith(conn);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });
});
