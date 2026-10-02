// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, isOrgAdmin: (role: string) => role === 'admin' || role === 'super_admin', json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/whatsapp/group-links/settings', () => ({ getGroupLinksEnabled: m.get, setGroupLinksEnabled: m.set }));
import { GET, PATCH } from './route';
const admin = {};
const user = { id: 'user', organizationId: 'tab-org', role: 'admin' };
const req = (body: unknown, origin?: string) => new Request('https://crm.test/api/settings/group-links', { method: 'PATCH', headers: { 'x-forwarded-host': 'crm.test', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ ok: true, admin, user }); m.get.mockResolvedValue(false); m.set.mockResolvedValue(undefined); });
describe('optional group link setting route', () => {
  it('reads organization from authenticated tab scope', async () => {
    expect(await (await GET()).json()).toEqual({ enabled: false });
    expect(m.get).toHaveBeenCalledWith(admin, 'tab-org');
  });
  it('returns auth errors', async () => {
    m.auth.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await GET()).status).toBe(401);
  });
  it('allows admin writes only in scoped org', async () => {
    expect(await (await PATCH(req({ enabled: true }))).json()).toEqual({ enabled: true });
    expect(m.set).toHaveBeenCalledWith(admin, 'tab-org', true);
  });
  it('rejects nonadmin writes', async () => {
    m.auth.mockResolvedValue({ ok: true, admin, user: { ...user, role: 'sales' } });
    expect((await PATCH(req({ enabled: true }))).status).toBe(403);
    expect(m.set).not.toHaveBeenCalled();
  });
  it.each([{ enabled: 'true' }, {}, { enabled: true, organizationId: 'other' }])('rejects invalid or extra input %j', async body => expect((await PATCH(req(body))).status).toBe(400));
  it('rejects cross origin before auth or write', async () => {
    expect((await PATCH(req({ enabled: true }, 'https://evil.test'))).status).toBe(403);
    expect(m.auth).not.toHaveBeenCalled(); expect(m.set).not.toHaveBeenCalled();
  });
  it('masks database errors and fails closed', async () => {
    m.get.mockRejectedValue(new Error('secret database detail'));
    const result = await GET(); expect(result.status).toBe(500); expect(JSON.stringify(await result.json())).not.toContain('secret');
  });
});
