import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgUser } from '@/lib/whatsapp/api';
const access = vi.hoisted(() => vi.fn());
vi.mock('./access', () => ({ conversationUsageAccess: access }));
import { usageNotices } from './notifications';

const from = '2026-10-23T00:00:00Z';
const until = '2026-10-24T00:00:00Z';
const user = { organizationId: 'org', id: 'user' } as OrgUser;
type Row = { id: string; conversation_id: string | null; created_at: string; organization_id: string; resolved_at: string | null; reason?: string | null };
const row = (id: string, conversationId: string | null = id): Row => ({
  id, conversation_id: conversationId, created_at: '2026-10-23T10:00:00Z', organization_id: 'org', resolved_at: null,
});
const numbered = (n: number) => row(`notice-${String(n).padStart(4, '0')}`);

function database(initial: Row[], onRead?: (read: number, rows: Row[]) => void, failAt?: number) {
  const rows = [...initial];
  const queries: Array<{ cursor?: string; limit?: number; order?: string; organization?: string; from?: string; until?: string; unresolved?: boolean }> = [];
  const db = { from: vi.fn((table: string) => {
    expect(table).toBe('ai_usage_notices');
    const state: typeof queries[number] = {};
    queries.push(state);
    const q = {
      select: () => q,
      eq: (column: string, value: string) => { expect(column).toBe('organization_id'); state.organization = value; return q; },
      is: (column: string, value: null) => { expect([column, value]).toEqual(['resolved_at', null]); state.unresolved = true; return q; },
      gte: (column: string, value: string) => { expect(column).toBe('created_at'); state.from = value; return q; },
      lte: (column: string, value: string) => { expect(column).toBe('created_at'); state.until = value; return q; },
      order: (column: string) => { state.order = column; return q; },
      gt: (column: string, value: string) => { expect(column).toBe('id'); state.cursor = value; return q; },
      limit: async (limit: number) => {
        state.limit = limit;
        if (queries.length === failAt) return { data: null, error: new Error('page unavailable') };
        onRead?.(queries.length, rows);
        return { data: rows.filter(r => r.organization_id === state.organization && !r.resolved_at &&
          (!state.from || r.created_at >= state.from) && r.created_at <= state.until! && (!state.cursor || r.id > state.cursor))
          .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit), error: null };
      },
    };
    return q;
  }) } as unknown as SupabaseClient;
  return { db, queries };
}

beforeEach(() => access.mockReset());

it('notifies only the visible responsible user with a stable internal alert', async () => {
  access.mockImplementation(async (_db, _user, id) => ({ allowed: id !== 'hidden', canGrant: id === 'own' }));
  const { db, queries } = database([row('hidden'), row('other'), row('own'), row('missing', null)]);
  const result = await usageNotices(db, user, from, until);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ id: 'ai-usage-own', kind: 'alert', category: 'ai_usage', href: '/chats?conversation=own' });
  expect(access).toHaveBeenCalledTimes(3);
  expect(queries).toEqual([{ organization: 'org', unresolved: true, from, until, order: 'id', limit: 200 }]);
});

it('identifies quota blocks without calling an unknown consumption error a reached limit', async () => {
  access.mockResolvedValue({ allowed: true, canGrant: true });
  const { db } = database([
    { ...row('cap'), reason: 'conversation_token_limit' },
    { ...row('unknown'), reason: 'reservation_unknown' },
  ]);
  expect((await usageNotices(db, user, from, until)).map(n => [n.category, n.title])).toEqual([
    ['ai_usage', 'IA pausada por limite'], ['ai_usage', 'IA pausada por consumo'],
  ]);
});

it('keeps 205 notices unique when older rows resolve and newer rows arrive between pages', async () => {
  access.mockResolvedValue({ allowed: true, canGrant: true });
  const { db, queries } = database(Array.from({ length: 205 }, (_, i) => numbered(i + 1)), (read, rows) => {
    if (read !== 2) return;
    rows.slice(0, 100).forEach(r => { r.resolved_at = until; });
    rows.push({ ...numbered(206), created_at: '2026-10-24T00:00:01Z' });
    rows.push({ ...numbered(207), organization_id: 'foreign' });
  });
  const result = await usageNotices(db, user, from, until);
  expect(result).toHaveLength(205);
  expect(new Set(result.map(n => n.id)).size).toBe(205);
  expect(result.at(-1)?.id).toBe('ai-usage-notice-0205');
  expect(queries).toHaveLength(2);
  expect(queries[1]).toEqual({ organization: 'org', unresolved: true, from, until, order: 'id', cursor: 'notice-0200', limit: 200 });
});

it('advances the cursor over a full page of inaccessible notices', async () => {
  access.mockImplementation(async (_db, _user, id: string) => ({ allowed: true, canGrant: id > 'notice-0200' }));
  const { db, queries } = database(Array.from({ length: 203 }, (_, i) => numbered(i + 1)));
  const result = await usageNotices(db, user, from, until);
  expect(result.map(n => n.id)).toEqual(['ai-usage-notice-0201', 'ai-usage-notice-0202', 'ai-usage-notice-0203']);
  expect(queries[1].cursor).toBe('notice-0200');
});

it('throws on a failed later page rather than returning a partial alert list', async () => {
  access.mockResolvedValue({ allowed: true, canGrant: true });
  const { db } = database(Array.from({ length: 201 }, (_, i) => numbered(i + 1)), undefined, 2);
  await expect(usageNotices(db, user, from, until)).rejects.toThrow('page unavailable');
});

it('loads old unresolved notices without a lower bound while excluding resolved ones', async () => {
  access.mockResolvedValue({ allowed: true, canGrant: true });
  const { db, queries } = database([
    { ...row('old'), created_at: '2026-09-01T00:00:00Z' },
    { ...row('resolved'), created_at: '2026-09-01T00:00:00Z', resolved_at: from },
  ]);
  const result = await usageNotices(db, user, null, until);
  expect(result.map(n => n.id)).toEqual(['ai-usage-old']);
  expect(queries[0].from).toBeUndefined();
});
