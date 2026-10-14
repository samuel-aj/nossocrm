import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), connection: vi.fn(), enabled: vi.fn(), create: vi.fn(), invite: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionByIdForOrg: m.connection, getWaGroupsEnabled: m.enabled }));
vi.mock('@/lib/whatsapp/groups', () => ({ createMetaGroup: m.create, getMetaGroupInviteLink: m.invite }));
import { POST } from './route';
const request = () => new Request('https://crm.test/api/whatsapp/groups/create', {
  method: 'POST', body: JSON.stringify({ connectionId: 'conn', subject: 'Demonstração' }),
});
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ ok: true, user: { id: 'u', organizationId: 'org' }, admin: { from: m.from } });
  m.enabled.mockResolvedValue(true);
  m.connection.mockResolvedValue({ id: 'conn', status: 'connected', provider: 'meta_cloud' });
});
describe('group creation refusal', () => {
  it('returns a readable eligibility error without saving a conversation or getting an invite', async () => {
    m.create.mockResolvedValue({ ok: false, code: 'GROUPS_NOT_ELIGIBLE', error: 'Este número não está habilitado pela Meta para criar grupos pela API oficial.' });
    const result = await POST(request());
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({ code: 'GROUPS_NOT_ELIGIBLE', error: 'Este número não está habilitado pela Meta para criar grupos pela API oficial.' });
    expect(m.from).not.toHaveBeenCalled();
    expect(m.invite).not.toHaveBeenCalled();
  });
  it('preserves other provider errors as upstream failures', async () => {
    m.create.mockResolvedValue({ ok: false, error: 'Falha de rede' });
    expect((await POST(request())).status).toBe(502);
    expect(m.from).not.toHaveBeenCalled();
  });
  it('does not dispatch group creation for a QR connection', async () => {
    m.connection.mockResolvedValue({ id: 'conn', status: 'connected', provider: 'evolution' });
    expect((await POST(request())).status).toBe(409);
    expect(m.create).not.toHaveBeenCalled();
  });
});
