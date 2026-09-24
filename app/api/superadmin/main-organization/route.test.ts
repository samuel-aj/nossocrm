import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { id: 'u' } as { id: string } | null, role: 'super_admin', config: '428e1830-2ff5-425a-b9b1-f9379897c2c6', adminFrom: vi.fn(), userFrom: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) }, from: mocks.userFrom }),
  createStaticAdminClient: () => ({ from: mocks.adminFrom }),
}));
vi.mock('@/lib/whatsapp/api', () => ({ json: (body: unknown, status = 200) => Response.json(body, { status }) }));
import { GET } from './route';
function chain(result: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() };
  for (const key of ['select', 'eq', 'is'] as const) q[key].mockReturnValue(q);
  q.single.mockResolvedValue(result); q.maybeSingle.mockResolvedValue(result);
  return q;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.user = { id: 'u' }; mocks.role = 'super_admin'; mocks.config = '428e1830-2ff5-425a-b9b1-f9379897c2c6';
  mocks.userFrom.mockImplementation(() => chain({ data: { role: mocks.role } }));
  mocks.adminFrom.mockImplementation((table) => chain({ data: table === 'platform_config' ? { value: mocks.config } : { id: mocks.config, name: 'Anúncio Jurídico' } }));
});
describe('main organization endpoint', () => {
  it('rejects unsigned requests before accessing configuration', async () => { mocks.user = null; expect((await GET()).status).toBe(401); expect(mocks.adminFrom).not.toHaveBeenCalled(); });
  it('checks stored superadmin role', async () => { mocks.role = 'admin'; expect((await GET()).status).toBe(403); expect(mocks.adminFrom).not.toHaveBeenCalled(); });
  it('returns only the configured home organization', async () => { const r = await GET(); expect(r.status).toBe(200); expect(await r.json()).toEqual({ organization: { id: mocks.config, name: 'Anúncio Jurídico' } }); });
  it('does not guess a destination when config is absent', async () => { mocks.config = ''; expect(await (await GET()).json()).toEqual({ organization: null }); expect(mocks.adminFrom).toHaveBeenCalledTimes(1); });
});
