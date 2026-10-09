import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ client: null as any, row: {} as Record<string, unknown>, writes: [] as Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> }));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => h.client }));
vi.mock('@/lib/supabase/actorClient', () => ({ withActor: (client: unknown) => client }));
vi.mock('@/lib/public-api/auth', () => ({ authPublicApi: async () => ({ ok: true, organizationId: 'org' }) }));
vi.mock('@/lib/public-api/resolve', () => ({
  resolveBoardId: async () => '11111111-1111-4111-8111-111111111111',
  resolveFirstStageId: async () => '22222222-2222-4222-8222-222222222222',
  resolveBoardIdFromKey: async () => null, resolveOwnerId: vi.fn(), resolveCompanyIdFromName: vi.fn(),
}));
import { POST, GET as list } from '@/app/api/public/v1/deals/route';
import { GET, PATCH } from '@/app/api/public/v1/deals/[dealId]/route';
import { POST as upsertContact } from '@/app/api/public/v1/contacts/route';
const id = '33333333-3333-4333-8333-333333333333';
const ctx = { params: Promise.resolve({ dealId: id }) };
const request = (method: string, body?: object) => new Request('http://localhost/api/public/v1/deals', { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
beforeEach(() => {
  h.row = { id, title: 'Lead', custom_fields: { origem: 'Meta Ads', utm_source: 'Instagram_Feed' }, lead_source: null, lead_source_initialized: false };
  h.writes = [];
  h.client = { from: (table: string) => {
    let payload: Record<string, unknown> | undefined;
    const filters: Record<string, unknown> = {};
    const response = (single: boolean) => {
      if (payload) {
        h.writes.push({ table, payload, filters });
        if (table === 'deals') h.row = { ...h.row, ...payload };
      }
      const row = table === 'deals' ? h.row : table === 'contacts' ? { id, source: 'WEBSITE', ...payload } : null;
      return { data: single ? row : row ? [row] : [], error: null, count: row ? 1 : 0 };
    };
    const q: any = {
      select: () => q, is: () => q, in: () => q, order: () => q, limit: () => q, range: () => q,
      eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      insert: (value: Record<string, unknown>) => { payload = value; return q; },
      update: (value: Record<string, unknown>) => { payload = value; return q; },
      maybeSingle: async () => response(true), single: async () => response(true),
      then: (resolve: any) => Promise.resolve(response(false)).then(resolve),
    };
    return q;
  } };
});
describe('native acquisition source in the public API', () => {
  it.each([undefined, null, ' Google Ads '])('accepts source %s on creation, preserving legacy fields', async source => {
    const res = await POST(request('POST', { title: 'Lead', board_key: 'sales', contact_id: id, lead_source: source, custom_fields: h.row.custom_fields }));
    expect(res.status).toBe(201);
    const write = h.writes.find(w => w.table === 'deals')!;
    expect(write.payload.custom_fields).toEqual({ origem: 'Meta Ads', utm_source: 'Instagram_Feed' });
    expect(write.payload.organization_id).toBe('org');
    if (source === undefined) expect(write.payload).not.toHaveProperty('lead_source');
    else expect(write.payload).toMatchObject({ lead_source: source?.trim() ?? null, lead_source_initialized: true });
    expect((await res.json()).data).not.toHaveProperty('lead_source_initialized');
  });
  it.each([undefined, null, 'Presencial'])('PATCH distinguishes omission from clearing: %s', async source => {
    const res = await PATCH(request('PATCH', { title: 'Updated', lead_source: source }), ctx);
    expect(res.status).toBe(200);
    const write = h.writes[0];
    expect(write.filters).toMatchObject({ organization_id: 'org', id });
    if (source === undefined) expect(write.payload).not.toHaveProperty('lead_source');
    else expect(write.payload).toMatchObject({ lead_source: source, lead_source_initialized: true });
    expect((await res.json()).data.lead_source).toBe(source === undefined ? 'Meta Ads' : source);
  });
  it('sends native clear together with conflicting legacy edit for DB precedence', async () => {
    const res = await PATCH(request('PATCH', { lead_source: null, custom_fields_patch: { origem: 'Google Ads' } }), ctx);
    expect(res.status).toBe(200);
    expect(h.writes[0].payload).toMatchObject({ lead_source: null, lead_source_initialized: true, custom_fields: { origem: 'Google Ads', utm_source: 'Instagram_Feed' } });
    expect((await res.json()).data.lead_source).toBeNull();
  });
  it('keeps an explicit legacy origem clear while removing ordinary custom keys', async () => {
    const res = await PATCH(request('PATCH', { custom_fields_patch: { origem: null, utm_source: null } }), ctx);
    expect(res.status).toBe(200);
    expect(h.writes[0].payload.custom_fields).toEqual({ origem: null });
    expect(h.writes[0].payload).not.toHaveProperty('lead_source');
  });
  it.each([false, true])('GET and list resolve legacy only before native initialization: %s', async initialized => {
    h.row.lead_source_initialized = initialized;
    const detail = (await (await GET(request('GET'), ctx)).json()).data;
    const rows = (await (await list(request('GET'))).json()).data;
    expect(detail.lead_source).toBe(initialized ? null : 'Meta Ads');
    expect(rows[0].lead_source).toBe(detail.lead_source);
    expect(detail).not.toHaveProperty('lead_source_initialized');
    expect(rows[0]).not.toHaveProperty('lead_source_initialized');
  });
  it('keeps the original acquisition on an idempotent creation retry', async () => {
    const res = await POST(request('POST', { title: 'Retry', external_id: 'external', lead_source: 'Google Ads' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.lead_source).toBe('Meta Ads');
    expect(h.writes).toEqual([]);
  });
  it.each([123, 'x'.repeat(121)])('rejects invalid source before writing: %s', async source => {
    const res = await PATCH(request('PATCH', { lead_source: source }), ctx);
    expect(res.status).toBe(422);
    expect(h.writes).toEqual([]);
  });
});
describe('contact source remains independent', () => {
  it.each([undefined, 'REFERRAL', ''])('upsert preserves omission and accepts an explicit source: %s', async source => {
    const res = await upsertContact(request('POST', { name: 'Ana', email: 'ana@example.com', source }));
    expect(res.status).toBe(200);
    if (source === undefined) expect(h.writes[0].payload).not.toHaveProperty('source');
    else expect(h.writes[0].payload.source).toBe(source || null);
    expect(h.writes.every(w => w.table === 'contacts')).toBe(true);
  });
});
