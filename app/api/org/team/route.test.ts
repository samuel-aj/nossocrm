import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), rpc: vi.fn(), origin: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/permissions/teamAccessServer', () => ({ getTeamAccess: m.access }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: m.origin }));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const request = (action: string, data: unknown) => new Request('https://staging.test/api/org/team', { method: 'POST', body: JSON.stringify({ action, data }) });
describe('team management authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.origin.mockReturnValue(true);
    m.auth.mockResolvedValue({ ok: true, user: { id, organizationId: id, role: 'admin' }, admin: { rpc: m.rpc } });
    m.access.mockResolvedValue({ canManage: false }); m.rpc.mockResolvedValue({ error: null });
  });
  it('ordinary administrators cannot assign roles', async () => {
    expect((await POST(request('assign', { userId: id, kind: 'admin', roleId: null }))).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('master cannot transfer the master role', async () => {
    m.access.mockResolvedValue({ canManage: true });
    expect((await POST(request('master', { userId: id }))).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('master assigns a role using authenticated actor and organization', async () => {
    m.access.mockResolvedValue({ canManage: true });
    expect((await POST(request('assign', { userId: id, kind: 'vendedor', roleId: null }))).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('team_manage', { p_org: id, p_actor: id, p_action: 'assign', p_data: { userId: id, kind: 'vendedor', roleId: null } });
  });
  it('rejects actor spoofing and invalid permissions', async () => {
    m.access.mockResolvedValue({ canManage: true });
    expect((await POST(request('assign', { userId: id, kind: 'admin', roleId: null, actorId: id }))).status).toBe(400);
    expect((await POST(request('saveRole', { name: 'Role', boards: [{ boardId: id, scope: 'all' }] }))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('only technical admin transfers and database denial is surfaced', async () => {
    m.auth.mockResolvedValue({ ok: true, user: { id, organizationId: id, role: 'super_admin' }, admin: { rpc: m.rpc } });
    m.access.mockResolvedValue({ canManage: true });
    expect((await POST(request('master', { userId: id }))).status).toBe(200);
    m.rpc.mockResolvedValue({ error: { code: '42501', message: 'Access changed' } });
    expect((await POST(request('master', { userId: id }))).status).toBe(403);
  });
  it('rejects cross-origin requests before querying authority', async () => {
    m.origin.mockReturnValue(false);
    expect((await POST(request('master', { userId: id }))).status).toBe(403);
    expect(m.auth).not.toHaveBeenCalled();
  });
});
