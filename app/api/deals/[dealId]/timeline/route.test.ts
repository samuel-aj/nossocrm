import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), auth: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.create }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: mocks.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
import { GET } from './route';
const dealId = '00000000-0000-4000-8000-000000000001';
const orgId = '00000000-0000-4000-8000-000000000002';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2020-01-01T00:00:00.123456+00:00';
let visible = true, failure = false;
let calls: Array<{ table: string; filters: unknown[][] }>;
function db() {
  return { from(table: string) {
    const call = { table, filters: [] as unknown[][] }; calls.push(call);
    let one = false;
    const q = {
      select: () => q, eq: (...args: unknown[]) => { call.filters.push(args); return q; }, is: (...args: unknown[]) => { call.filters.push(args); return q; },
      order: () => q, limit: (n: number) => { call.filters.push(['limit', n]); return q; }, abortSignal: () => q,
      or: (filter: string) => { call.filters.push(['or', filter]); return q; }, maybeSingle: () => { one = true; return q; },
      then(resolve: (result: unknown) => void) {
        if (table === 'deals') return resolve({ data: visible ? { id: dealId } : null, error: null });
        if (one) return resolve({ data: { created_at: at }, error: null });
        const rows = Array.from({ length: 51 }, (_, n) => ({ id: id(n + 10), created_at: at, organization_id: orgId, deal_id: dealId, type: 'note', date: at, title: 'old note', description: 'old body', completed: true, actor_kind: 'system', actor_id: null, created_by: null, assigned_to: null, content: 'API note' }));
        return resolve({ data: rows, error: failure ? { message: 'database failed' } : null });
      },
    }; return q;
  } };
}
beforeEach(() => { visible = true; failure = false; calls = []; mocks.create.mockResolvedValue(db()); mocks.auth.mockResolvedValue({ ok: true, user: { organizationId: orgId }, admin: { from: vi.fn(() => { throw new Error('No unauthorized privileged reads'); }) } }); });
const request = (suffix = '') => GET(new Request(`https://crm.test/api/deals/${dealId}/timeline${suffix}`), { params: Promise.resolve({ dealId }) });
describe('authorized timeline endpoint', () => {
  it('normalizes a bounded page with old lowercase notes and applies source RLS, org/deal and soft delete filters', async () => {
    const response = await request(); const page = await response.json();
    expect(response.status).toBe(200);
    expect(page.activities.length + page.history.events.length + page.history.apiNotes.length).toBeLessThanOrEqual(50);
    expect(page.nextCursor).toBeTruthy();
    expect(page.history.apiNotes[0].createdAt).toBe(at);
    for (const table of ['activities', 'deal_notes', 'deal_events']) {
      const call = calls.find(c => c.table === table)!;
      expect(call.filters).toContainEqual(['organization_id', orgId]);
      expect(call.filters).toContainEqual(['deal_id', dealId]);
      expect(call.filters).toContainEqual(['limit', 51]);
    }
    expect(calls.find(c => c.table === 'activities')?.filters).toContainEqual(['deleted_at', null]);
  });
  it('reads all three normalized sources through tied page boundaries including old note bodies', async () => {
    let cursor: string | null = null;
    const allPages: Array<{ source: string; id: string }> = [];
    do {
      const page = await (await request(cursor ? `?cursor=${encodeURIComponent(cursor)}` : '')).json();
      expect(page.activities.length + page.history.events.length + page.history.apiNotes.length).toBeLessThanOrEqual(50);
      for (const a of page.activities) { expect(a.description).toBe('old body'); expect(a.type).toBe('note'); allPages.push({ source: 'activity', id: a.id }); }
      for (const e of page.history.events) allPages.push({ source: 'event', id: e.id });
      for (const n of page.history.apiNotes) allPages.push({ source: 'note', id: n.id });
      cursor = page.nextCursor;
    } while (cursor);
    expect(allPages).toHaveLength(153);
    expect(new Set(allPages.map(item => `${item.source}:${item.id}`)).size).toBe(allPages.length);
  });
  it.each(['foreign organization', 'RLS-hidden lead', 'soft-deleted lead'])('returns 404 for %s before reading sources', async () => {
    visible = false; const unauthorizedResponse = await request();
    expect(unauthorizedResponse.status).toBe(404);
    expect(calls.map(c => c.table)).toEqual(['deals']);
  });
  it('rejects bad cursor before reading database', async () => { expect((await request('?cursor=bad')).status).toBe(400); expect(calls).toEqual([]); });
  it('returns failures rather than empty history', async () => { failure = true; expect((await request()).status).toBe(500); });
});
