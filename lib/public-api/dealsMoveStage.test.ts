import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ client: null as any, writes: [] as Record<string, unknown>[] }));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => h.client }));
vi.mock('@/lib/supabase/actorClient', () => ({ withActor: (client: unknown) => client }));
vi.mock('@/lib/public-api/resolve', () => ({ resolveBoardId: async () => '00000000-0000-4000-8000-000000000002' }));
import { moveStageByDealId, moveStageByIdentity } from './dealsMoveStage';
const dealId = '00000000-0000-4000-8000-000000000001';
const boardId = '00000000-0000-4000-8000-000000000002';
const protocolId = '00000000-0000-4000-8000-000000000003';
const lostId = '00000000-0000-4000-8000-000000000004';
let stageId: string;
beforeEach(() => {
  h.writes = []; stageId = protocolId;
  h.client = { from: (table: string) => {
    let patch: Record<string, unknown> | undefined;
    const response = (single: boolean) => {
      const rows = table === 'boards' ? [{ id: boardId, won_stage_id: protocolId, lost_stage_id: lostId }]
        : table === 'board_stages' ? [{ id: stageId }]
        : table === 'contacts' ? [{ id: 'contact' }]
        : [{ id: dealId, board_id: boardId, stage_id: 'before', is_won: false, lead_source: null, lead_source_initialized: true, custom_fields: { origem: 'Meta Ads' }, ...patch }];
      if (patch) h.writes.push(patch);
      return { data: single ? rows[0] : rows, error: null };
    };
    const q: any = { select: () => q, eq: () => q, is: () => q, in: () => q, order: () => q,
      limit: () => q, update: (value: Record<string, unknown>) => { patch = value; return q; },
      maybeSingle: async () => response(true), then: (resolve: any) => Promise.resolve(response(false)).then(resolve) };
    return q;
  } };
});
const move = (identity: boolean, mark?: 'won' | 'lost') => identity ? moveStageByIdentity({ organizationId: 'org', boardKeyOrId: boardId, email: 'test@example.com', target: { to_stage_id: stageId }, mark })
  : moveStageByDealId({ organizationId: 'org', dealId, target: { to_stage_id: stageId }, mark, lossCategory: 'qualified', lossReason: 'Preço' });
describe('API stage movement delegates automatic commercial outcomes to the DB', () => {
  it.each([false, true])('does not force a win for the old protocol shortcut (by identity=%s)', async identity => {
    expect(await move(identity)).toMatchObject({ ok: true });
    expect(h.writes[0]).toMatchObject({ stage_id: protocolId });
    expect(h.writes[0]).not.toHaveProperty('is_won');
    expect(h.writes[0]).not.toHaveProperty('closed_at');
  });
  it('preserves an explicit win instruction', async () => {
    await move(false, 'won');
    expect(h.writes[0]).toMatchObject({ is_won: true, is_lost: false });
  });
  it('keeps loss details for an explicit lost stage', async () => {
    stageId = lostId;
    await move(false);
    expect(h.writes[0]).toMatchObject({ is_won: false, is_lost: true, loss_category: 'qualified', loss_reason: 'Preço' });
  });
});

it.each([false, true])('movement responses keep explicit unknown without leaking storage flags (identity=%s)', async identity => {
  const result = await move(identity);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected movement response');
  expect(result.body.data.lead_source).toBeNull();
  expect(result.body.data).not.toHaveProperty('lead_source_initialized');
});
