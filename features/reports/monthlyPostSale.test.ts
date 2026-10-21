import { describe, expect, it } from 'vitest';
import type { Board, Deal } from '@/types';
import { calculatePerformance, type LifecycleEvent, type PeriodRange, type StageEvent } from './performanceMetrics';
import { board, lead, lifecycle, movement } from './performanceTestFixtures';

const period: PeriodRange = { start: new Date('2026-10-01T00:00:00-04:00'), end: new Date('2026-10-31T23:59:59.999-04:00') };
const snapshot = new Date('2026-11-02T12:00:00Z');
const arrivalDate = '2026-10-15T14:00:00.123456Z';
const ids = (deals: readonly Deal[]) => deals.map(deal => deal.id).sort();
const retained = (id: string, extra: Partial<Deal> = {}) => lead(id, {
  createdAt: '2026-09-05T12:00:00Z', status: 'won', isWon: true, closedAt: '2026-09-20T12:00:00Z', ...extra,
});
const arrival = (deal: Deal, date = arrivalDate, extra: Partial<LifecycleEvent> = {}) => lifecycle(deal, 'stage_changed', date, {
  stageId: 'won', isWon: deal.isWon, isLost: false, ...extra,
});
function calculate(deals: Deal[], events: LifecycleEvent[] = [], visits: StageEvent[] = [], owner = '', product = '',
  range = period, selectedBoard: Board = board, cutoff = snapshot) {
  return calculatePerformance(deals, visits, selectedBoard, range, owner, undefined, cutoff, { mode: 'monthly', lifecycleEvents: events, productId: product });
}
const postSale = (report: ReturnType<typeof calculate>, id = 'won') => report.entryFunnel.stages.find(stage => stage.stageId === id)!;

describe('monthly post-sale arrivals', () => {
  it('counts seven retained arrivals: three current gains, two earlier gains and two without a gain; excludes a subsequent loss', () => {
    const currentGains = Array.from({ length: 3 }, (_, index) => retained(`current-${index}`, {
      createdAt: '2026-10-05T12:00:00Z', closedAt: '2026-10-10T12:00:00Z', leadSource: 'Google Ads',
    }));
    const oldGains = [retained('previous-a'), retained('previous-b')];
    const withoutGain = [retained('no-gain-a', { isWon: false, closedAt: undefined }), retained('no-gain-b', { isWon: false, closedAt: undefined })];
    const lost = retained('subsequently-lost', { status: 'lost', isWon: false, isLost: true, closedAt: '2026-10-15T14:00:05.123456Z' });
    const kept = [...currentGains, ...oldGains, ...withoutGain];
    const deals = [...kept, lost];
    const baseEvents = deals.flatMap(deal => [
      lifecycle(deal, 'entered_board', deal.createdAt, { stageId: 'new' }),
      lifecycle(deal, 'qualified', deal.createdAt.startsWith('2026-10') ? '2026-10-06T12:00:00Z' : '2026-09-06T12:00:00Z', { stageId: 'q' }),
      ...(deal.isWon ? [lifecycle(deal, 'won', deal.closedAt!, { stageId: 'signed' })] : []),
    ]);
    baseEvents.push(lifecycle(lost, 'lost', lost.closedAt!, { stageId: 'lost' }));
    const baseline = calculate(deals, baseEvents);
    // One legacy arrival exists only in deal_stage_events, with no matching ledger row.
    const result = calculate(deals, [...baseEvents, ...deals.filter(deal => deal.id !== 'current-0').map(deal => arrival(deal))],
      deals.map(deal => movement(deal.id, 'won', arrivalDate, deal.isWon ? 'signed' : 'q')));

    expect(ids(postSale(result).deals)).toEqual(ids(kept));
    expect(postSale(result).count).toBe(7);
    expect(postSale(result).countingMethod).toBe('arrivals_in_period');
    expect(postSale(result).milestoneLabel).toBe('Pós-venda no período');
    expect(postSale(result).evidenceByDeal.size).toBe(7);
    for (const deal of kept) expect(postSale(result).evidenceByDeal.get(deal.id)).toEqual({
      kind: 'stage', date: arrivalDate, stageName: 'Protocolado', observedAtStage: true,
    });
    for (const key of ['entries', 'qualifiedDeals', 'qualifiedCount', 'wonDeals', 'wonRevenue', 'entryWonDeals', 'outsideEntryWonDeals',
      'leadSourceGroups', 'leadSourceTotal', 'qualificationRate', 'closingRate', 'totalConversionRate'] as const) {
      expect(result[key], key).toEqual(baseline[key]);
    }
    expect(result.entries).toHaveLength(3);
    expect(result.qualifiedCount).toBe(3);
    expect(ids(result.wonDeals)).toEqual(ids(currentGains));
    expect(result.wonRevenue).toBe(300);
    expect(result.entryFunnel.stages.find(stage => stage.milestone === 'customer')?.count).toBe(3);
  });

  it('rejects absent, earlier, later and future evidence even when the current stage is Protocolado', () => {
    const deals = ['missing', 'before', 'after', 'future', 'inside'].map(id => retained(id));
    const result = calculate(deals, [
      arrival(deals[1], '2026-09-30T23:59:59-04:00'),
      arrival(deals[2], '2026-11-01T00:00:00-04:00'),
      arrival(deals[3], '2026-10-25T12:00:00Z'),
      arrival(deals[4]),
    ], [], '', '', period, board, new Date('2026-10-21T12:00:00Z'));
    expect(ids(postSale(result).deals)).toEqual(['inside']);
    expect(result.wonDeals).toEqual([]);
    expect(result.entries).toEqual([]);
  });

  it('respects the selected local day and displays the exact arrival timestamp', () => {
    const day = { start: new Date('2026-10-19T00:00:00-04:00'), end: new Date('2026-10-19T23:59:59.999-04:00') };
    const deals = ['before', 'midnight', 'late', 'next-day'].map(id => retained(id));
    const dates = ['2026-10-19T03:59:59.999Z', '2026-10-19T04:00:00.000Z', '2026-10-20T03:59:59.998999Z', '2026-10-20T04:00:00.000Z'];
    const events = deals.map((deal, index) => arrival(deal, dates[index]));
    const daily = calculate(deals, events, [], '', '', day);
    expect(ids(postSale(daily).deals)).toEqual(['late', 'midnight']);
    expect(postSale(daily).evidenceByDeal.get('late')?.date).toBe(dates[2]);
    expect(postSale(calculate(deals, events)).count).toBe(4);
  });

  it('uses the owner and product snapshot of the arrival, without rewriting the current-gain filters', () => {
    const deal = retained('snapshot', { ownerId: 'bia', items: [{ id: 'new-item', productId: 'p2', name: 'Current product', quantity: 1, price: 900 }] });
    const proof = arrival(deal, arrivalDate, { ownerId: 'ana', items: lead('original').items });
    const original = calculate([deal], [proof], [], 'ana', 'p1');
    expect(ids(postSale(original).deals)).toEqual([deal.id]);
    expect(postSale(original).deals[0]).toMatchObject({ ownerId: 'ana', items: [{ productId: 'p1' }] });
    expect(postSale(calculate([deal], [proof], [], 'bia', 'p2')).count).toBe(0);
    expect(original.entries).toEqual([]);
    expect(original.wonDeals).toEqual([]);
    expect(original.wonRevenue).toBe(0);
  });

  it.each(['customer-promotion', 'explicit-won-stage'] as const)('keeps distinct arrival snapshots within the same millisecond: %s', kind => {
    const configured: Board = kind === 'customer-promotion' ? board : {
      ...board, wonStageId: 'signed', stages: board.stages.map(stage => stage.id === 'signed'
        ? { ...stage, linkedLifecycleStage: 'custom-contract' } : stage),
    };
    const oldDate = '2026-10-15T14:00:00.100100Z';
    const newDate = '2026-10-15T14:00:00.100900Z';
    const newItems = [{ id: 'new-item', productId: 'p2', name: 'New product', quantity: 1, price: 900 }];
    const deal = retained('precise-snapshots', { ownerId: 'bia', items: newItems, leadSource: 'Google Ads' });
    const events = [
      arrival(deal, oldDate, { ownerId: 'ana', items: lead('old-product').items, leadSource: 'Meta Ads' }),
      arrival(deal, '2026-10-15T14:00:00.100500Z', { stageId: 'signed', ownerId: 'bia', items: newItems }),
      arrival(deal, newDate, { ownerId: 'bia', items: newItems, leadSource: 'Google Ads' }),
    ];
    const visits = [movement(deal.id, 'won', newDate, 'signed'), movement(deal.id, 'won', oldDate, 'signed')];
    const filtered = calculate([deal], events, visits, 'bia', 'p2', period, configured);
    const all = calculate([deal], events, visits, '', '', period, configured);
    for (const result of [filtered, all]) {
      expect(postSale(result).count).toBe(1);
      expect(postSale(result).deals[0]).toMatchObject({ ownerId: 'bia', items: [{ productId: 'p2' }], leadSource: 'Google Ads' });
      expect(postSale(result).evidenceByDeal.get(deal.id)).toMatchObject({ kind: 'stage', date: newDate, observedAtStage: true });
      expect(result.entries).toEqual([]);
      expect(result.wonDeals).toEqual([]);
    }
  });

  it('does not borrow a future snapshot within the same millisecond for a legacy arrival', () => {
    const priorDate = '2026-10-15T14:00:00.099900Z';
    const legacyDate = '2026-10-15T14:00:00.100100Z';
    const futureDate = '2026-10-15T14:00:00.100900Z';
    const newItems = [{ id: 'new-item', productId: 'p2', name: 'New product', quantity: 1, price: 900 }];
    const deal = retained('legacy-precision', { ownerId: 'bia', items: newItems, leadSource: 'Google Ads' });
    const events = [
      lifecycle(deal, 'qualified', priorDate, { stageId: 'q', ownerId: 'ana', items: lead('old-product').items, leadSource: 'Meta Ads' }),
      arrival(deal, futureDate, { ownerId: 'bia', items: newItems, leadSource: 'Google Ads' }),
    ];
    const result = calculate([deal], events, [movement(deal.id, 'won', legacyDate, 'signed')], 'ana', 'p1');
    expect(postSale(result).count).toBe(1);
    expect(postSale(result).deals[0]).toMatchObject({ ownerId: 'ana', items: [{ productId: 'p1' }], leadSource: 'Meta Ads' });
    expect(postSale(result).evidenceByDeal.get(deal.id)).toMatchObject({ kind: 'stage', date: legacyDate, observedAtStage: true });
    expect(result.entries).toEqual([]);
    expect(result.wonDeals).toEqual([]);
  });

  it('deduplicates the ledger and stage history, including repeated direct arrivals by the same lead', () => {
    const deal = retained('duplicate');
    const later = '2026-10-16T14:00:00Z';
    const result = calculate([deal], [arrival(deal), arrival(deal, later)], [
      movement(deal.id, 'won', arrivalDate, 'signed'), movement(deal.id, 'won', later, 'signed'),
    ]);
    expect(ids(postSale(result).deals)).toEqual([deal.id]);
    expect(postSale(result).count).toBe(1);
    expect(postSale(result).evidenceByDeal.size).toBe(1);
    expect([arrivalDate, later]).toContain(postSale(result).evidenceByDeal.get(deal.id)?.date);
  });

  it('requires a direct arrival and keeps it only while the lead remains in this board at that stage or beyond', () => {
    const configured: Board = { ...board, stages: [
      ...board.stages.filter(stage => stage.id !== 'lost'),
      { id: 'complete', label: 'Concluído', color: '#123456', linkedLifecycleStage: 'custom-complete' },
      board.stages.find(stage => stage.id === 'lost')!,
    ] };
    const regressed = retained('regressed', { status: 'signed' });
    const transferred = retained('transferred', { boardId: 'other-board' });
    const foreignHistory = retained('foreign-history');
    const skipped = retained('skipped', { status: 'complete' });
    const beyond = retained('beyond', { status: 'complete' });
    const unchanged = retained('unchanged', { isWon: false, closedAt: undefined });
    const result = calculate([regressed, transferred, foreignHistory, skipped, beyond, unchanged], [
      arrival(regressed), arrival(transferred, arrivalDate, { boardId: board.id }),
      arrival(foreignHistory, arrivalDate, { boardId: 'other-board' }),
      arrival(skipped, arrivalDate, { stageId: 'complete' }), arrival(beyond),
      arrival(beyond, '2026-10-16T12:00:00Z', { stageId: 'complete' }), arrival(unchanged),
    ], [], '', '', period, configured);
    expect(ids(postSale(result).deals)).toEqual(['beyond', 'unchanged']);
    expect(ids(postSale(result, 'complete').deals)).toEqual(['beyond', 'skipped']);
    expect(postSale(result).evidenceByDeal.get('beyond')?.observedAtStage).toBe(true);
    expect(result.wonDeals).toEqual([]);
    expect(result.entries).toEqual([]);
  });
});
