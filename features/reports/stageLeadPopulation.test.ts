import { expect, it } from 'vitest';
import { calculatePerformance } from './performanceMetrics';
import { august, board, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';

it('cada barra contém exatamente os IDs observados da coorte, sem duplicatas, ganhos antigos nem eventos futuros', () => {
  const a = lead('a');
  const b = lead('b');
  const old = lead('old', { createdAt: '2026-07-01' });
  const other = lead('other', { ownerId: 'other' });
  const foreign = lead('foreign', { boardId: 'other' });
  const events = [lifecycle(a, 'entered_board', a.createdAt), lifecycle(b, 'entered_board', b.createdAt),
    lifecycle(old, 'won', '2026-08-02', { stageId: 'won' }), lifecycle(other, 'entered_board', other.createdAt),
    lifecycle(foreign, 'entered_board', foreign.createdAt, { boardId: 'other' })];
  const history = [movement('a', 'q'), movement('a', 'q'), movement('a', 'signed', '2026-08-10', 'q'),
    movement('a', 'new', '2026-08-11', 'signed'), movement('b', 'q', '2026-09-01'),
    movement('old', 'won'), movement('other', 'q'), { ...movement('foreign', 'q'), boardId: 'other' }];
  const data = calculatePerformance([a, b, old, other, foreign], history, board, august, 'ana', undefined, snapshot, { lifecycleEvents: events });
  expect(data.stageData.map(stage => stage.deals.map(deal => deal.id))).toEqual([['a', 'b'], ['a'], [], ['a'], []]);
  for (const stage of data.stageData) {
    expect(stage.deals).toHaveLength(stage.count);
    expect(new Set(stage.deals.map(deal => deal.id)).size).toBe(stage.count);
    expect(stage.deals.every(deal => data.entries.some(entry => entry.id === deal.id))).toBe(true);
    if (stage.conversionRate !== null) expect(stage.conversionRate).toBeLessThanOrEqual(100);
  }
});

it('carteira atual particiona os abertos; fluxo mede chegadas reais sem taxa', () => {
  const deals = [lead('a', { status: 'q' }), lead('b', { status: 'proposal' }), lead('closed', { isWon: true })];
  const current = calculatePerformance(deals, [], board, august, '', undefined, snapshot, { mode: 'current' });
  expect(current.stageData.reduce((sum, stage) => sum + stage.count, 0)).toBe(current.currentDeals.length);
  expect(current.stageData.every(stage => stage.comparisonBase === '' && stage.conversionRate === null)).toBe(true);
  const period = calculatePerformance(deals, [movement('a', 'q'), movement('b', 'proposal'), movement('b', 'proposal')], board, august, '', undefined, snapshot, { mode: 'period' });
  expect(period.stageData.map(stage => stage.count)).toEqual([0, 1, 1, 0, 0]);
  expect(period.stageData.every(stage => stage.comparisonBase === '' && stage.conversionRate === null)).toBe(true);
});
