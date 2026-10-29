import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../_shared', () => ({ guardRoute: mocks.guard, validationError: () => new Response('invalid', { status: 400 }) }));
import { GET } from './route';
const id = '10000000-0000-4000-8000-000000000001';
const org = '20000000-0000-4000-8000-000000000001';
const query = 'start=2026-10-26T00:00:00-04:00&end=2026-11-01T23:59:59.999-04:00';
const call = (params = query, bot = id) => GET(new Request(`http://localhost/api/wa-agents/bots/${bot}/analytics?${params}`), { params: Promise.resolve({ id: bot }) });
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ ok: true, user: { organizationId: org }, admin: { rpc: mocks.rpc } }); });
describe('robot analytics route', () => {
  it('requires administrator permission before querying and returns the guard response', async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: new Response('forbidden', { status: 403 }) });
    expect((await call()).status).toBe(403); expect(mocks.guard).toHaveBeenCalledWith({ admin: true }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed ids, reversed periods, timezone-free dates and invalid revisions', async () => {
    for (const params of ['start=no&end=no', 'start=2026-10-30T00:00:00Z&end=2026-10-29T00:00:00Z', 'start=2026-10-01&end=2026-10-31', `${query}&revision=other`]) expect((await call(params)).status).toBe(400);
    expect((await call(query, 'invalid')).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('scopes reads to the authenticated organization and treats foreign bot as missing', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await call(`${query}&organizationId=evil`)).status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledWith('wa_bot_analytics', expect.objectContaining({ p_org: org, p_bot: id, p_revision: null, p_goal: null }));
  });
  it('returns explicit errors instead of zero metrics on query failure', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'missing relation', code: '42P01' } });
    expect((await call()).status).toBe(500);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Unknown revision' } });
    expect((await call()).status).toBe(400);
  });
  it('disables caching and does not expose database-only fields', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: {
      botId: id, asOf: new Date().toISOString(), measurementStartedAt: null, legacyRuns: 0,
      selectedRevision: 'r', isCurrentRevision: true, revisions: [], summary: { runs: 0, uniqueSubjects: 0, running: 0, waiting: 0, done: 0, errored: 0, cancelled: 0 },
      steps: [], groups: [], stepCounts: [], groupCounts: [], outputCounts: [], variantCounts: [], goalStepId: null, secret: 'hidden',
    } });
    const response = await call(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain('hidden');
  });
});
