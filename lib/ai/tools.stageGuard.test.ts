import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('ai', () => ({ tool: (definition: unknown) => definition }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: () => { throw new Error('Use the test client'); } }));
import { createCRMTools } from './tools';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let writes: Array<{ table: string; ids: unknown[]; updates: Row }>;
let stageError: Error | null;
let beforeUpdate: (() => void) | undefined;

/** Service-role fake: no RLS. Only explicit query filters protect the other board/tenant. */
function client() {
  return { from: (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let updates: Row | undefined;
    let max = Infinity;
    const execute = (single = false) => {
      if (table === 'board_stages' && stageError) return { data: null, error: stageError };
      if (updates) beforeUpdate?.();
      const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(0, max);
      if (updates) {
        writes.push({ table, ids: rows.map(row => row.id), updates });
        rows.forEach(row => Object.assign(row, updates));
      }
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return builder; },
      is: (column: string, value: unknown) => { filters.push(row => (row[column] ?? null) === value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return builder; },
      or: () => builder,
      order: () => builder,
      limit: (value: number) => { max = value; return builder; },
      update: (patch: Row) => { updates = patch; return builder; },
      single: async () => execute(true),
      maybeSingle: async () => execute(true),
      then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    };
    return builder;
  } } as unknown as SupabaseClient;
}

beforeEach(() => {
  tables = {
    boards: [{ id: 'board-a', organization_id: 'org-a' }],
    deals: [{ id: 'deal', organization_id: 'org-a', board_id: 'board-a', title: 'Lead', stage_id: 'old' }],
    board_stages: [
      { id: 'own', organization_id: 'org-a', board_id: 'board-a', name: 'Proposta' },
      { id: 'other-board', organization_id: 'org-a', board_id: 'board-b', name: 'Proposta' },
      { id: 'other-org', organization_id: 'org-b', board_id: 'board-a', name: 'Proposta' },
    ],
  };
  writes = []; stageError = null; beforeUpdate = undefined;
});

function tools() { return createCRMTools({ organizationId: 'org-a', boardId: 'board-a' }, 'user', client()); }
function moveBulk(stageId: string) {
  return tools().moveDealsBulk.execute({ dealIds: ['deal'], stageId, allowPartial: false, maxDeals: 50, createFollowUpTask: false, followUpDueInDays: 2, followUpType: 'TASK' });
}

describe('AI stage ownership guards', () => {
  it.each(['other-board', 'other-org', 'missing'])('rejects a direct stage ID outside the deal board/organization: %s', async stageId => {
    expect(await tools().moveDeal.execute({ dealId: 'deal', stageId })).toMatchObject({ error: expect.stringContaining('não pertence') });
    expect(writes).toEqual([]);
    expect(tables.deals[0].stage_id).toBe('old');
  });

  it.each(['other-board', 'other-org', 'missing'])('applies the same guard to a bulk move: %s', async stageId => {
    expect(await moveBulk(stageId)).toMatchObject({ error: expect.stringContaining('não pertence') });
    expect(writes).toEqual([]);
  });

  it('moves single and bulk deals when the stage belongs to the correct board and organization', async () => {
    expect(await tools().moveDeal.execute({ dealId: 'deal', stageId: 'own' })).toMatchObject({ success: true });
    expect(await moveBulk('own')).toMatchObject({ success: true, movedCount: 1 });
    expect(writes.map(write => write.ids)).toEqual([['deal'], ['deal']]);
    expect(tables.deals[0].stage_id).toBe('own');
  });

  it('fails closed when the stage lookup errors', async () => {
    stageError = new Error('offline');
    expect(await tools().moveDeal.execute({ dealId: 'deal', stageId: 'own' })).toMatchObject({ error: expect.stringContaining('offline') });
    expect(await moveBulk('own')).toMatchObject({ error: expect.stringContaining('offline') });
    expect(writes).toEqual([]);
  });

  it('does not pick an arbitrary stage when a name is ambiguous', async () => {
    tables.board_stages.push({ id: 'other-proposal', organization_id: 'org-a', board_id: 'board-a', name: 'Proposta jurídica' });
    expect(await tools().moveDeal.execute({ dealId: 'deal', stageName: 'Proposta' })).toMatchObject({ error: expect.stringContaining('ambíguo') });
    expect(writes).toEqual([]);
  });

  it('does not write a stage from the old board if the deal changes boards during validation', async () => {
    beforeUpdate = () => { tables.deals[0].board_id = 'board-b'; };
    expect(await tools().moveDeal.execute({ dealId: 'deal', stageId: 'own' })).toMatchObject({ success: false, error: expect.stringContaining('mudou de board') });
    expect(writes[0].ids).toEqual([]);
    expect(tables.deals[0].stage_id).toBe('old');
  });
});


describe('AI explicit commercial win destination', () => {
  it('chooses CUSTOMER in the actual board rather than a stage called Protocolado', async () => {
    tables.boards[0].won_stage_id = 'protocol';
    tables.board_stages.push(
      { id: 'signed', organization_id: 'org-a', board_id: 'board-a', linked_lifecycle_stage: 'CUSTOMER', order: 1 },
      { id: 'protocol', organization_id: 'org-a', board_id: 'board-a', linked_lifecycle_stage: 'CUSTOM_PROTOCOL', order: 2 },
    );
    const api = createCRMTools({ organizationId: 'org-a', boardId: 'stale-board', wonStage: 'Protocolado' }, 'user', client());
    expect(await api.markDealAsWon.execute({ dealId: 'deal' })).toMatchObject({ success: true });
    expect(writes[0].updates).toMatchObject({ stage_id: 'signed', is_won: true });
  });
  it('preserves an explicit stay-in-stage win option', async () => {
    tables.boards[0].won_stay_in_stage = true;
    expect(await tools().markDealAsWon.execute({ dealId: 'deal' })).toMatchObject({ success: true });
    expect(writes[0].updates).not.toHaveProperty('stage_id');
    expect(writes[0].updates.is_won).toBe(true);
  });
  it('uses the configured manual destination when no CUSTOMER stage exists', async () => {
    tables.boards[0].won_stage_id = 'own';
    expect(await tools().markDealAsWon.execute({ dealId: 'deal' })).toMatchObject({ success: true });
    expect(writes[0].updates).toMatchObject({ stage_id: 'own', is_won: true });
  });
  it('rejects a manual destination outside the current board', async () => {
    tables.boards[0].won_stage_id = 'other-board';
    expect(await tools().markDealAsWon.execute({ dealId: 'deal' })).toMatchObject({ success: false });
    expect(writes).toEqual([]);
  });
});
