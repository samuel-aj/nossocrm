// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: 'admin', upsert: vi.fn(), eq: vi.fn(), row: {} as Record<string, unknown>, allowed: true }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => mocks.allowed }));
vi.mock('@/lib/supabase/tabOrgScope', () => ({ withTabOrg: async () => ({ organization_id: 'active-org', role: mocks.role }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from: () => { const query = { select: () => query, eq: () => query, single: async () => ({ data: { organization_id: 'home-org', role: 'admin' } }) }; return query; },
  }),
  createStaticAdminClient: () => ({ from: () => {
    const query = { select: () => query, eq: (...args: unknown[]) => { mocks.eq(...args); return query; }, maybeSingle: async () => ({ data: mocks.row }), upsert: mocks.upsert };
    return query;
  } }),
}));
import { GET, PATCH } from './route';
const request = (data: unknown) => new Request('https://crm.test/api/settings/org', { method: 'PATCH', body: JSON.stringify(data) });
beforeEach(() => { vi.clearAllMocks(); mocks.role = 'admin'; mocks.row = {}; mocks.allowed = true; mocks.upsert.mockResolvedValue({ error: null }); });
it('reads source options from the authorized active organization', async () => {
  mocks.row = { lead_source_options: ['Presencial'], inactive_leads_enabled: true };
  expect(await (await GET()).json()).toMatchObject({ lead_source_options: ['Presencial'], inactive_leads_enabled: true });
  expect(mocks.eq).toHaveBeenCalledWith('organization_id', 'active-org');
});
it('saves only source options, normalized and deduplicated, into the active organization', async () => {
  const result = await PATCH(request({ lead_source_options: [' Google   Ads ', 'google ads', 'Indicação', 'Não informado'] }));
  expect(result.status).toBe(200);
  expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith({ organization_id: 'active-org', lead_source_options: ['Google Ads', 'Indicação'] }, { onConflict: 'organization_id' });
});
it.each([null, []])('preserves the distinction between restoring defaults and an empty list: %j', async options => {
  expect((await PATCH(request({ lead_source_options: options }))).status).toBe(200);
  expect(mocks.upsert.mock.calls[0][0].lead_source_options).toEqual(options);
});
it('does not write source categories when an unrelated preference changes', async () => {
  await PATCH(request({ inactive_leads_enabled: false }));
  expect(mocks.upsert.mock.calls[0][0]).toEqual({ organization_id: 'active-org', inactive_leads_enabled: false });
});
it('blocks cross-origin requests and nonadmin organization membership', async () => {
  mocks.role = 'sales';
  expect((await PATCH(request({ lead_source_options: ['Meta Ads'] }))).status).toBe(403);
  mocks.role = 'admin'; mocks.allowed = false;
  expect((await PATCH(request({ lead_source_options: ['Meta Ads'] }))).status).toBe(403);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it.each([[...Array(51)].map((_, index) => String(index)), ['x'.repeat(121)], ['']])('rejects invalid source options', async options => {
  expect((await PATCH(request({ lead_source_options: options }))).status).toBe(422);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
