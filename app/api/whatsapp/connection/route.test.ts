import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mock = vi.hoisted(() => ({
  auth: vi.fn(), rows: vi.fn(), visibility: vi.fn(), subset: vi.fn(),
  diagnostics: vi.fn(), provider: vi.fn(), dedupe: vi.fn(), observe: vi.fn(), byId: vi.fn(), validate: vi.fn(),
}));
vi.mock('@/lib/whatsapp/api', () => ({
  requireOrgUser: mock.auth, isOrgAdmin: (role: string) => role === 'admin',
  json: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('@/lib/permissions/server', () => ({ getVisibilityRules: mock.visibility, filterAllowedConnections: mock.subset }));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionsByOrg: mock.rows, getConnectionByIdForOrg: mock.byId }));
vi.mock('@/lib/whatsapp/connectionIncidents', () => ({ observeConnection: mock.observe }));
vi.mock('@/lib/whatsapp/connectionDiagnostics', () => ({ getLineDiagnostics: mock.diagnostics }));
vi.mock('@/lib/whatsapp', () => ({ getProvider: mock.provider, isBusinessConnection: () => false,
  isMetaCloudConnection: (row: { provider: string }) => row.provider === 'meta_cloud' }));
vi.mock('@/lib/whatsapp/metaCloudSetup', () => ({ validateMetaCredentials: mock.validate }));
vi.mock('@/lib/whatsapp/dedupe', () => ({ enforceOneConnectionPerNumber: mock.dedupe, phoneKey: (v: string) => v }));

const visible = { id: 'public-number', status: 'connected', phone_number: '100', organization_id: 'org-a', instance_token: 'private' };
const hidden = { id: 'restricted', status: 'disconnected', phone_number: '200', organization_id: 'org-a' };
beforeEach(() => {
  vi.resetAllMocks();
  mock.auth.mockResolvedValue({ ok: true, user: { organizationId: 'org-a', id: 'u', role: 'seller' }, admin: 'db' });
  mock.rows.mockResolvedValue([visible, hidden]);
  mock.subset.mockReturnValue([visible]);
  mock.diagnostics.mockResolvedValue([{ state: 'send_failure' }]);
  mock.provider.mockReturnValue({ checkConnectionHealth: async () => ({ state: 'connected' }),
    getPairingIdentity: async () => ({ phone: '100' }) });
  mock.byId.mockResolvedValue(visible);
});
describe('connection health and QR reconciliation', () => {
  it('only reads health for permitted numbers, without provider calls or merging connections', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const data = await response.json();
    expect(data.connections).toHaveLength(1);
    expect(data.connections[0]).toMatchObject({ id: visible.id, diagnostics: { state: 'send_failure' } });
    expect(JSON.stringify(data)).not.toContain('private');
    expect(mock.diagnostics).toHaveBeenCalledWith('db', 'org-a', [visible]);
    expect(mock.provider).not.toHaveBeenCalled();
    expect(mock.dedupe).not.toHaveBeenCalled();
  });
  it('does not treat failure to load numbers as a new organization', async () => {
    mock.rows.mockRejectedValue(new Error('offline'));
    expect((await GET()).status).toBe(503);
  });
  it('limits reconciliation to the paired number after an administrator finishes pairing', async () => {
    const post = () => POST(new Request('https://crm.test/api/whatsapp/connection', {
      method: 'POST', body: JSON.stringify({ mode: 'finish_pairing', connectionId: visible.id }),
    }));
    expect((await post()).status).toBe(403);
    expect(mock.dedupe).not.toHaveBeenCalled();
    mock.auth.mockResolvedValue({ ok: true, user: { organizationId: 'org-a', role: 'admin' }, admin: 'db' });
    mock.dedupe.mockResolvedValue([]);
    expect((await post()).status).toBe(200);
    expect(mock.dedupe).toHaveBeenCalledWith('db', 'org-a', [visible]);
  });
  it('confirms the number from the provider after a successful pairing whose webhook was missed', async () => {
    mock.auth.mockResolvedValue({ ok: true, user: { organizationId: 'org-a', role: 'admin' }, admin: 'db' });
    mock.rows.mockResolvedValue([{ ...visible, status: 'connecting', phone_number: null }]);
    mock.provider.mockReturnValue({ checkConnectionHealth: async () => ({ state: 'connected' }),
      getPairingIdentity: async () => ({ phone: '100' }) });
    mock.byId.mockResolvedValue(visible);
    mock.dedupe.mockResolvedValue([]);
    const res = await POST(new Request('https://crm.test/api/whatsapp/connection', { method: 'POST',
      body: JSON.stringify({ mode: 'finish_pairing', connectionId: visible.id }) }));
    expect(res.status).toBe(200);
    expect(mock.observe).toHaveBeenCalledWith('db', visible.id, 'connected', 'manual', expect.any(String), 'pairing_confirmed', { phone: '100' });
    expect(mock.dedupe).toHaveBeenCalledWith('db', 'org-a', [visible]);
  });
  it('does not merge lines when the paired phone is different from the saved identity', async () => {
    mock.auth.mockResolvedValue({ ok: true, user: { organizationId: 'org-a', role: 'admin' }, admin: 'db' });
    mock.provider.mockReturnValue({ checkConnectionHealth: async () => ({ state: 'connected' }),
      getPairingIdentity: async () => ({ phone: 'wrong' }) });
    const res = await POST(new Request('https://crm.test/api/whatsapp/connection', { method: 'POST',
      body: JSON.stringify({ mode: 'finish_pairing', connectionId: visible.id }) }));
    expect(res.status).toBe(409);
    expect(mock.dedupe).not.toHaveBeenCalled();
  });
  it('keeps the history of a disconnected Meta line separate when a different phone is entered', async () => {
    mock.auth.mockResolvedValue({ ok: true, user: { organizationId: 'org-a', role: 'admin' }, admin: 'db' });
    mock.rows.mockResolvedValue([{ ...visible, provider: 'meta_cloud', status: 'disconnected', meta_phone_number_id: null,
      last_connected_at: '2026-11-18T12:00:00Z' }]);
    mock.validate.mockResolvedValue({ ok: true, phoneNumberId: '2', displayPhoneNumber: '200' });
    const res = await POST(new Request('https://crm.test/api/whatsapp/connection', { method: 'POST',
      body: JSON.stringify({ mode: 'meta_cloud', metaToken: 'fake', metaNumberId: '2', metaBusinessId: '3', editingConnectionId: visible.id }) }));
    expect(res.status).toBe(409);
    expect(mock.observe).not.toHaveBeenCalled();
  });
});
