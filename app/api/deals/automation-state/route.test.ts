// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), visible: vi.fn(), eq: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/boards/loadAutomationState', () => ({ loadAutomationState: m.load }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => {
  const q = { select: () => q, eq: (...args: unknown[]) => { m.eq(...args); return q; }, in: () => q, is: m.visible }; return q;
} }) }));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const req = (body: unknown = { dealIds: [id] }) => new Request('https://crm.test/api/deals/automation-state', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ ok: true, user: { id: 'user', organizationId: 'org' }, admin: {} }); m.visible.mockResolvedValue({ data: [{ id, contact_id: 'contact' }], error: null }); m.load.mockResolvedValue({ [id]: null }); });
it('checks organization and RLS before loading privileged state, disables HTTP caching', async () => {
  const response = await POST(req());
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(m.eq).toHaveBeenCalledWith('organization_id', 'org');
  expect(m.load).toHaveBeenCalledWith({}, { id: 'user', organizationId: 'org' }, [{ id, contact_id: 'contact' }]);
});
it('passes only visible leads, ignoring requested IDs from other tenants', async () => {
  m.visible.mockResolvedValue({ data: [], error: null }); m.load.mockResolvedValue({});
  expect(await (await POST(req())).json()).toEqual({ automations: {} });
  expect(m.load).toHaveBeenCalledWith({}, expect.anything(), []);
});
it('fails closed on database errors instead of reporting no automation', async () => {
  m.visible.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
  expect((await POST(req())).status).toBe(500); expect(m.load).not.toHaveBeenCalled();
});
it('rejects anonymous access, invalid batches, spoofed organization and cross origin', async () => {
  expect((await POST(req({ dealIds: [id], organizationId: 'other' }))).status).toBe(400);
  expect((await POST(req({ dealIds: Array(101).fill(id) }))).status).toBe(400);
  expect((await POST(req({ dealIds: ['invalid'] }))).status).toBe(400);
  m.auth.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) });
  expect((await POST(req())).status).toBe(401);
  expect((await POST(new Request('https://crm.test/api/deals/automation-state', { method: 'POST', headers: { origin: 'https://evil.test', host: 'crm.test', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ dealIds: [id] }) }))).status).toBe(403);
});
