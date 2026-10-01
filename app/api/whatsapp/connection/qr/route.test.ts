import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connections: vi.fn(), qr: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({
  requireOrgUser: mocks.auth, isOrgAdmin: (role: string) => ['admin', 'super_admin'].includes(role),
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionsByOrg: mocks.connections, upsertConnection: vi.fn() }));
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ getQrCode: mocks.qr }), isBusinessConnection: () => false }));
vi.mock('@/lib/whatsapp/admin', () => ({ ensureEvolutionInstance: vi.fn(), registerWebhook: vi.fn() }));
import { GET } from './route';
beforeEach(() => vi.resetAllMocks());
describe('legacy QR endpoint protects both linking methods', () => {
  it('requires authentication', async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response('', { status: 401 }) });
    expect((await GET(new Request('https://crm.test/api/whatsapp/connection/qr'))).status).toBe(401);
    expect(mocks.connections).not.toHaveBeenCalled();
  });
  it('does not expose a pending code or QR to non-administrators', async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { role: 'sales', organizationId: 'org-a' } });
    expect((await GET(new Request('https://crm.test/api/whatsapp/connection/qr?id=private'))).status).toBe(403);
    expect(mocks.qr).not.toHaveBeenCalled(); expect(mocks.connections).not.toHaveBeenCalled();
  });
  it('keeps the admin QR flow available', async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { role: 'admin', organizationId: 'org-a' }, admin: 'admin-client' });
    mocks.connections.mockResolvedValue([{ id: 'conn-a' }]); mocks.qr.mockResolvedValue({ state: 'connecting', qrBase64: 'qr' });
    const result = await GET(new Request('https://crm.test/api/whatsapp/connection/qr?id=conn-a'));
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ qrBase64: 'qr' });
  });
});
