import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  guard: vi.fn(), access: vi.fn(), load: vi.fn(), client: vi.fn(), from: vi.fn(),
  upsert: vi.fn(), remove: vi.fn(), eq: vi.fn(), templates: vi.fn(), webhook: vi.fn(),
  deleteWebhook: vi.fn(),
}));
vi.mock('@/app/api/wa-agents/_shared', () => ({
  guardRoute: h.guard,
  readJsonBody: (req: Request) => req.json(),
  validationError: () => Response.json({ error: 'invalid' }, { status: 400 }),
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));
vi.mock('@/lib/whatsapp/api', () => ({ json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/permissions/teamAccessServer', () => ({ getTeamAccess: h.access }));
vi.mock('@/lib/zapsign/signatures', () => ({
  loadZapSignSettings: h.load, clientFor: h.client, newWebhookSecret: () => 'test-webhook-secret',
}));
import { GET, PUT, DELETE } from './route';

const admin = { from: h.from };
const user = { id: 'master-a', organizationId: 'org-a', role: 'admin' };
function request(method: string) {
  return new Request('https://crm.example.test/api/integrations/zapsign/settings', {
    method,
    headers: { origin: 'https://crm.example.test', 'content-type': 'application/json' },
    ...(method === 'PUT' ? { body: JSON.stringify({ api_token: 'fake-test-token-1234', sandbox: true, organization_id: 'org-b' }) } : {}),
  });
}
const operations = [
  ['GET', () => GET()], ['PUT', () => PUT(request('PUT'))], ['DELETE', () => DELETE(request('DELETE'))],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  h.guard.mockResolvedValue({ ok: true, admin, user: { ...user } });
  h.access.mockResolvedValue({ masterUserId: user.id, canManage: true });
  h.load.mockResolvedValue(null);
  h.from.mockReturnValue({ upsert: h.upsert, delete: h.remove });
  h.upsert.mockResolvedValue({ error: null });
  h.remove.mockReturnValue({ eq: h.eq });
  h.eq.mockResolvedValue({ error: null });
  h.client.mockReturnValue({ listTemplates: h.templates, createWebhook: h.webhook, deleteWebhook: h.deleteWebhook });
  h.templates.mockResolvedValue([{ name: 'Modelo de teste' }]);
  h.webhook.mockResolvedValue({ id: 'webhook-test' });
});

describe.each(operations)('ZapSign settings %s', (method, run) => {
  it('permite o Mestre e usa a organização da sessão', async () => {
    expect((await run()).status).toBe(200);
    expect(h.access).toHaveBeenCalledWith(admin, 'org-a', 'master-a');
    expect(h.load).toHaveBeenCalledWith(admin, 'org-a');
    if (method === 'PUT') {
      expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 'org-a' }), { onConflict: 'organization_id' });
    }
    if (method === 'DELETE') expect(h.eq).toHaveBeenCalledWith('organization_id', 'org-a');
  });

  it('bloqueia administrador comum antes de ler configuração ou chamar ZapSign', async () => {
    h.access.mockResolvedValue({ masterUserId: 'another-user', canManage: false });
    expect((await run()).status).toBe(403);
    expect(h.load).not.toHaveBeenCalled();
    expect(h.client).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it('não libera organização sem Mestre definido', async () => {
    h.access.mockResolvedValue({ masterUserId: null, canManage: false });
    expect((await run()).status).toBe(403);
    expect(h.load).not.toHaveBeenCalled();
  });

  it('preserva o superadministrador', async () => {
    h.guard.mockResolvedValue({ ok: true, admin, user: { ...user, role: 'super_admin' } });
    expect((await run()).status).toBe(200);
    expect(h.access).not.toHaveBeenCalled();
  });

  it('falha de permissão bloqueia sem acessar a integração', async () => {
    h.access.mockRejectedValue(new Error('RPC unavailable'));
    expect((await run()).status).toBe(503);
    expect(h.load).not.toHaveBeenCalled();
    expect(h.client).not.toHaveBeenCalled();
  });

  it.each([401, 403])('preserva rejeição %s de sessão, papel ou origem', async status => {
    h.guard.mockResolvedValue({ ok: false, response: Response.json({ error: 'blocked' }, { status }) });
    expect((await run()).status).toBe(status);
    expect(h.guard).toHaveBeenCalledWith(expect.objectContaining({ admin: true }));
    if (method !== 'GET') expect(h.guard).toHaveBeenCalledWith(expect.objectContaining({ req: expect.any(Request) }));
    expect(h.access).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
  });

  it('reconsulta o Mestre depois de trocar de organização', async () => {
    expect((await run()).status).toBe(200);
    h.guard.mockResolvedValue({ ok: true, admin, user: { ...user, organizationId: 'org-b' } });
    h.access.mockResolvedValue({ masterUserId: 'master-b', canManage: false });
    expect((await run()).status).toBe(403);
    expect(h.access).toHaveBeenLastCalledWith(admin, 'org-b', user.id);
  });
});
