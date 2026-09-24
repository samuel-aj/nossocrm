// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), visible: vi.fn(), eq: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => {
  const q = { select: () => q, eq: (...args: unknown[]) => { m.eq(...args); return q; }, is: () => q, maybeSingle: m.visible }; return q;
} }) }));
import { POST } from './route';
const dealId = '11111111-1111-4111-8111-111111111111';
const expectedId = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ dealId }) };
const req = (body: unknown = { expectedId }) => new Request('https://crm.test/api/deals/'+dealId+'/alert', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ ok: true, user: { id: 'user', organizationId: 'org' }, admin: { rpc: m.rpc } }); m.visible.mockResolvedValue({ data: { id: dealId }, error: null }); m.rpc.mockResolvedValue({ data: true, error: null }); });
it('uses authenticated org, actor and expected version after RLS visibility', async () => {
  expect((await POST(req(), context)).status).toBe(200);
  expect(m.eq).toHaveBeenCalledWith('organization_id', 'org');
  expect(m.rpc).toHaveBeenCalledWith('acknowledge_deal_alert', { p_org: 'org', p_user: 'user', p_deal: dealId, p_expected: expectedId });
});
it('rejects another org or invisible lead before privileged mutation', async () => {
  m.visible.mockResolvedValue({ data: null, error: null });
  expect((await POST(req(), context)).status).toBe(404);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('rejects spoofed actors and preserves stale/repeated acknowledgements', async () => {
  expect((await POST(req({ expectedId, user: 'other' }), context)).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
  m.rpc.mockResolvedValue({ data: false, error: null });
  expect(await (await POST(req(), context)).json()).toEqual({ acknowledged: false });
});
it('rejects anonymous and cross-origin requests', async () => {
  m.auth.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) });
  expect((await POST(req(), context)).status).toBe(401);
  const cross = new Request('https://crm.test/api/deals/'+dealId+'/alert', { method: 'POST', headers: { origin: 'https://evil.test', host: 'crm.test', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ expectedId }) });
  expect((await POST(cross, context)).status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
});
