import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { getCurrentOrganizationId } from '@/lib/supabase/orgId';
import { august, board } from './performanceTestFixtures';
const mocks = vi.hoisted(() => ({ invalidate: vi.fn(), on: vi.fn(), subscribe: vi.fn(), remove: vi.fn(), channel: vi.fn(), from: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'seller' }, organizationId: 'org', loading: false }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { channel: mocks.channel, removeChannel: mocks.remove, from: mocks.from } }));
vi.mock('@/lib/supabase/orgId', () => ({ getCurrentOrganizationId: vi.fn() }));
import { usePerformanceReport } from './usePerformanceReport';

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };
let tables: Record<string, Row[]>;
let failedTable: string | undefined;
const filters: unknown[][] = [];
// This fake evaluates every filter and page. Incorrect board/ID/org scoping changes
// the returned data instead of silently returning a hand-picked expected fixture.
class Query implements PromiseLike<Result> {
  private predicates: ((row: Row) => boolean)[] = [];
  private offset = 0;
  private limit = Infinity;
  constructor(private table: string) {}
  select() { return this; }
  eq(key: string, value: unknown) { filters.push([this.table, 'eq', key, value]); this.predicates.push(row => row[key] === value); return this; }
  is(key: string, value: unknown) { filters.push([this.table, 'is', key, value]); this.predicates.push(row => row[key] === value); return this; }
  in(key: string, values: unknown[]) { filters.push([this.table, 'in', key, values]); this.predicates.push(row => values.includes(row[key])); return this; }
  order() { return this; }
  range(from: number, to: number) { this.offset = from; this.limit = to + 1; return this; }
  then<T = Result, E = never>(resolve?: ((value: Result) => T | PromiseLike<T>) | null, reject?: ((reason: unknown) => E | PromiseLike<E>) | null): PromiseLike<T | E> {
    const data = (tables[this.table] || []).filter(row => row.visible !== false && this.predicates.every(predicate => predicate(row))).slice(this.offset, this.limit);
    return Promise.resolve({ data: failedTable === this.table ? null : data, error: failedTable === this.table ? { message: 'history unavailable' } : null }).then(resolve, reject);
  }
}
beforeEach(() => {
  vi.clearAllMocks(); filters.length = 0; tables = {}; failedTable = undefined;
  const channel = { on: mocks.on, subscribe: mocks.subscribe };
  mocks.channel.mockReturnValue(channel); mocks.on.mockReturnValue(channel); mocks.subscribe.mockReturnValue(channel);
  mocks.from.mockImplementation((table: string) => new Query(table));
  vi.mocked(getCurrentOrganizationId).mockResolvedValue('org');
});
function queryOptions() {
  return vi.mocked(useQuery).mock.calls.at(-1)![0] as unknown as { queryKey: unknown[]; queryFn: () => Promise<NonNullable<ReturnType<typeof usePerformanceReport>['data']>> };
}
const row = (id: string, extra: Row = {}): Row => ({ id, title: id, organization_id: 'org', board_id: 'board', stage_id: 'new', created_at: '2026-08-01', updated_at: '2026-10-01', deleted_at: null, is_won: false, is_lost: false, value: 100, owner_id: 'ana', ...extra });
const history = (type: string, date: string, extra: Row = {}): Row => ({ id: type, organization_id: 'org', deal_id: 'transferred', board_id: 'board', event_type: type, occurred_at: date,
  source: 'transition', snapshot_source: 'transition', stage_id: type === 'qualified' ? 'q' : type === 'won' ? 'won' : 'new', owner_id: 'ana', value: 250,
  title: 'Original', deal_created_at: '2026-08-01', items: [{ id: 'original-item', product_id: 'p1', name: 'Produto antigo', quantity: 1, price: 250 }],
  is_won: type === 'won', is_lost: false, ...extra });

it('consulta board histórico e inclui transferidos visíveis, preservando vendedor/produto/valor do evento', async () => {
  tables = {
    deals: [row('current'), row('transferred', { board_id: 'other', owner_id: 'bia', value: 999 }), row('foreign-org', { organization_id: 'other-org' }), row('hidden', { visible: false }), row('deleted', { deleted_at: '2026-10-01' })],
    deal_lifecycle_events: [history('entered_board', '2026-08-01'), history('qualified', '2026-08-02'), history('won', '2026-08-03'),
      history('won', '2026-08-03', { id: 'wrong-board', deal_id: 'current', board_id: 'other' }),
      history('won', '2026-08-03', { id: 'hidden', deal_id: 'hidden' }), history('won', '2026-08-03', { id: 'deleted', deal_id: 'deleted' })],
    deal_stage_events: [{ id: 'q', organization_id: 'org', deal_id: 'transferred', board_id: 'board', to_stage_id: 'q', from_stage_id: 'new', occurred_at: '2026-08-02' }],
    deal_items: [{ id: 'new-item', organization_id: 'org', deal_id: 'transferred', product_id: 'p2', name: 'Produto atual', quantity: 1, price: 999 }],
    profiles: [{ id: 'ana', first_name: 'Ana' }, { id: 'bia', first_name: 'Bia' }],
  };
  renderHook(() => usePerformanceReport(board, august, 'ana', undefined, 'p1', 'period'));
  const options = queryOptions();
  expect(options.queryKey.slice(-2)).toEqual(['period', 'p1']);
  const data = await options.queryFn();
  expect(data.entries.map(deal => deal.id)).toEqual(['transferred']);
  expect(data.wonRevenue).toBe(250);
  expect(data.closingRate).toBeNull();
  expect(data.wonDeals[0]).toMatchObject({ ownerId: 'ana', owner: { name: 'Ana' }, title: 'Original' });
  expect(data.wonDeals[0].items[0].productId).toBe('p1');
  expect(data.productOptions).toContainEqual({ id: 'p1', name: 'Produto antigo' });
  expect(data.productOptions).toContainEqual({ id: 'p2', name: 'Produto atual' });
  expect(filters).toContainEqual(['deal_lifecycle_events', 'eq', 'organization_id', 'org']);
  expect(filters).toContainEqual(['deal_lifecycle_events', 'eq', 'board_id', 'board']);
  expect(filters).toContainEqual(['deals', 'in', 'id', ['transferred', 'hidden', 'deleted']]);
  expect(mocks.from).not.toHaveBeenCalledWith('activities');
  expect(mocks.from).not.toHaveBeenCalledWith('webhook_events_out');
});

it('regras, ordem e modo fazem parte da chave; eventos e etapas invalidam relatório', () => {
  const { rerender, unmount } = renderHook(({ selectedBoard, mode }: { selectedBoard: typeof board; mode: 'cohort' | 'period' }) => usePerformanceReport(selectedBoard, august, '', undefined, '', mode), { initialProps: { selectedBoard: board, mode: 'cohort' } });
  const before = queryOptions().queryKey;
  const changed = { ...board, stages: board.stages.map(stage => stage.id === 'q' ? { ...stage, linkedLifecycleStage: 'LEAD' } : stage) };
  rerender({ selectedBoard: changed, mode: 'cohort' });
  expect(queryOptions().queryKey).not.toEqual(before);
  const rulesChanged = queryOptions().queryKey;
  rerender({ selectedBoard: changed, mode: 'period' });
  expect(queryOptions().queryKey).not.toEqual(rulesChanged);
  for (const table of ['deal_lifecycle_events', 'deal_stage_events', 'board_stages', 'boards']) {
    const subscription = mocks.on.mock.calls.find(call => call[1].table === table)!;
    expect(subscription[1].filter).toBe('organization_id=eq.org');
    subscription[2]();
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['performance-report', 'org'] });
  }
  unmount(); expect(mocks.remove).toHaveBeenCalled();
});

it('recusa organização alterada antes de consultar qualquer tabela', async () => {
  vi.mocked(getCurrentOrganizationId).mockResolvedValue('different');
  renderHook(() => usePerformanceReport(board, august, ''));
  await expect(queryOptions().queryFn()).rejects.toThrow('Organização indisponível');
  expect(mocks.from).not.toHaveBeenCalled();
});

it('erro de histórico não é apresentado como um relatório completo com zeros', async () => {
  failedTable = 'deal_lifecycle_events';
  tables.deals = [row('current')];
  renderHook(() => usePerformanceReport(board, august, ''));
  await expect(queryOptions().queryFn()).rejects.toThrow('history unavailable');
});
