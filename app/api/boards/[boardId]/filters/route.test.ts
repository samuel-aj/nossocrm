import { beforeEach, describe, it, expect, vi } from 'vitest';
import { EMPTY_GENERAL, EMPTY_PERIOD } from '@/features/boards/filters/boardFilters';
const m = vi.hoisted(() => ({ auth: vi.fn(), board: vi.fn(), read: vi.fn(), write: vi.fn(), origin: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: m.origin }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.auth }, from: (table: string) => {
  const chain = { select: () => chain, eq: (...args: unknown[]) => { m.eq(...args); return chain; }, maybeSingle: table === 'boards' ? m.board : m.read,
    upsert: (data: unknown, opts: unknown) => { m.write(data, opts); return chain; }, single: async () => ({ data: { general: EMPTY_GENERAL, period: EMPTY_PERIOD }, error: null }) };
  return chain;
} }) }));
import { GET, PATCH } from './route';
const boardId = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ boardId }) };
const req = (body?: unknown, org = 'org') => new Request('https://staging.test/api/boards/'+boardId+'/filters', { method: body === undefined ? 'GET' : 'PATCH', headers: { 'x-org-id': org }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
describe('personal filter API', () => {
  beforeEach(() => { vi.clearAllMocks(); m.origin.mockReturnValue(true); m.auth.mockResolvedValue({ data: { user: { id: 'actor' } } }); m.board.mockResolvedValue({ data: { id: boardId, organization_id: 'org' } }); m.read.mockResolvedValue({ data: null }); });
  it('reads only the authenticated user and returns empty personal defaults', async () => {
    const res = await GET(req(), context);
    expect(await res.json()).toEqual({ general: null, period: null });
    expect(m.eq).toHaveBeenCalledWith('user_id', 'actor');
    expect(m.eq).toHaveBeenCalledWith('board_id', boardId);
  });
  it('allows a member to save only one group and uses the authenticated user', async () => {
    expect((await PATCH(req({ general: { ...EMPTY_GENERAL, status: 'all', product: 'one' } }), context)).status).toBe(200);
    expect(m.write).toHaveBeenCalledWith({ user_id: 'actor', board_id: boardId, general: { ...EMPTY_GENERAL, status: 'all', product: 'one' } }, { onConflict: 'user_id,board_id' });
    expect((await PATCH(req({ period: null }), context)).status).toBe(200);
    expect(m.write).toHaveBeenLastCalledWith({ user_id: 'actor', board_id: boardId, period: null }, { onConflict: 'user_id,board_id' });
  });
  it('rejects actor spoofing, invalid dates and empty patches', async () => {
    for (const data of [{ user_id: 'other', period: EMPTY_PERIOD }, {}, { period: { ...EMPTY_PERIOD, preset: 'custom', start: '2026-02-30', end: '2026-03-01' } }]) {
      expect((await PATCH(req(data), context)).status).toBe(422);
    }
    expect(m.write).not.toHaveBeenCalled();
  });
  it('rejects anonymous, forbidden funnel, wrong organization and cross-origin requests', async () => {
    expect((await PATCH(req({ period: null }, 'different-org'), context)).status).toBe(403);
    m.board.mockResolvedValue({ data: null });
    expect((await GET(req(), context)).status).toBe(403);
    m.auth.mockResolvedValue({ data: { user: null } });
    expect((await GET(req(), context)).status).toBe(401);
    m.origin.mockReturnValue(false);
    expect((await PATCH(req({ period: null }), context)).status).toBe(403);
    expect(m.write).not.toHaveBeenCalled();
  });
});
