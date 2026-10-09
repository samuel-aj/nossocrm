import { describe, expect, it } from 'vitest';
import type { Deal } from '@/types';
import { calculatePerformance, type LifecycleEvent, type StageEvent } from './performanceMetrics';
import { august, board, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';

const ids = (deals: readonly Deal[]) => deals.map(deal => deal.id).sort();
const gain = (id: string, extra: Partial<Deal> = {}) => lead(id, { createdAt: '2026-07-01T12:00:00Z',
  status: 'won', isWon: true, closedAt: '2026-08-15T12:00:00Z', ...extra });
const entry = (deal: Deal) => lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'new', isWon: false });
const calculate = (deals: Deal[], events: StageEvent[] = [], lifecycleEvents: LifecycleEvent[] = [], mode: 'monthly' | 'conversion' = 'monthly', owner = '', productId = '') =>
  calculatePerformance(deals, events, board, august, owner, undefined, snapshot, { mode, lifecycleEvents, productId });

describe('monthly retained-gain overlay', () => {
  it('preserves baseline entries, Q, losses, snapshots, sources, filters and pre-gain populations exactly', () => {
    const changed = gain('changed', { ownerId: 'bia', leadSource: 'Google Ads', value: 700,
      items: [{ id: 'new', productId: 'p2', name: 'Atual', quantity: 1, price: 700 }] });
    const lost = lead('lost', { isLost: true, status: 'lost', closedAt: '2026-08-20T12:00:00Z' });
    const old = lead('old', { createdAt: '2026-07-01T00:00:00Z' });
    const ledger = [entry(changed), entry(lost), lifecycle(changed, 'qualified', '2026-08-05T12:00:00Z', { stageId: 'q' }),
      lifecycle(lost, 'lost', lost.closedAt!, { lossCategory: 'disqualified', lossReason: 'Original' }),
      lifecycle(old, 'lost', '2026-08-10T12:00:00Z'), lifecycle(lost, 'reopened', '2026-08-21T12:00:00Z')];
    ledger[0] = { ...ledger[0], ownerId: 'ana', owner: { name: 'Ana', avatar: '' }, items: lead('old-product').items,
      leadSource: 'Meta Ads', value: 100 };
    const events = [movement(changed.id, 'q', '2026-08-05T12:00:00Z', 'new'), movement(old.id, 'proposal')];
    for (const [owner, product] of [['', ''], ['ana', 'p1'], ['bia', 'p2'], ['', 'p1'], ['', '__none__']]) {
      const baseline = calculate([changed, lost, old], events, ledger, 'conversion', owner, product);
      const monthly = calculate([changed, lost, old], events, ledger, 'monthly', owner, product);
      for (const key of ['entries', 'qualifiedDeals', 'qualifiedIds', 'qualificationDates', 'lostDeals', 'reopenedDeals',
        'leadSourceGroups', 'leadSourceTotal', 'currentDeals', 'unknownStageDeals', 'excludedQualificationDeals', 'coverage'] as const) {
        expect(monthly[key], `${key} filter ${owner}/${product}`).toEqual(baseline[key]);
      }
      expect(monthly.workedDeals).toBe(monthly.entries);
      expect(monthly.qualificationRate).toBe(baseline.qualificationRate);
      for (const stage of baseline.entryFunnel.stages.filter(stage => !stage.role && stage.milestone !== 'customer')) {
        const actual = monthly.entryFunnel.stages.find(item => item.stageId === stage.stageId)!;
        expect(actual.deals).toEqual(stage.deals);
        expect(actual.evidenceByDeal).toEqual(stage.evidenceByDeal);
      }
    }
    const report = calculate([changed, lost, old], events, ledger);
    expect(report.leadSourceGroups.find(group => group.label === 'Meta Ads')?.deals[0].ownerId).toBe('ana');
    expect(report.lostDeals).toHaveLength(1);
    expect(report.wonDeals[0].value).toBe(700);
  });

  it('keeps seven retained gains, five from entries, without expanding the entry population', () => {
    const winners = Array.from({ length: 7 }, (_, i) => gain(`win${i}`, { value: (i + 1) * 100 }));
    const pending = lead('pending', { status: 'signed' });
    const reopened = lead('reopened', { status: 'signed' });
    const lost = lead('lost', { status: 'lost', isLost: true, closedAt: '2026-08-15T12:00:06.210Z' });
    const undated = gain('undated', { closedAt: undefined });
    const ledger = [...winners.slice(0, 5).flatMap(deal => [entry(deal), lifecycle(deal, 'qualified', '2026-08-03T12:00:00Z')]),
      lifecycle(pending, 'won', '2026-08-10T12:00:00Z', { source: 'history', snapshotSource: 'current' }),
      lifecycle(reopened, 'won', '2026-08-10T12:00:00Z'), lifecycle(reopened, 'reopened', '2026-09-05T12:00:00Z'),
      lifecycle(lost, 'won', '2026-08-15T12:00:00Z'), lifecycle(lost, 'lost', lost.closedAt!)];
    const result = calculate([...winners, pending, reopened, lost, undated], [], ledger);
    expect(ids(result.wonDeals)).toEqual(ids(winners));
    expect(result.wonRevenue).toBe(2800);
    expect(result.entries).toHaveLength(5);
    expect(result.workedDeals).toBe(result.entries);
    expect(result.leadSourceTotal).toBe(5);
    expect(result.entryWonDeals).toHaveLength(5);
    expect(result.cohortWonDeals).toHaveLength(5);
    expect(result.outsideEntryWonDeals).toHaveLength(2);
    expect(result.unqualifiedWonDeals).toEqual([]);
    expect(result.qualificationRate).toBe(100);
    expect(result.closingRate).toBe(100);
    expect(result.totalConversionRate).toBe(100);
    expect(ids(result.entryFunnel.stages.find(stage => stage.milestone === 'customer')!.deals)).toEqual(ids(winners));
    for (const stage of result.entryFunnel.stages.filter(stage => !stage.role && stage.milestone !== 'customer')) {
      expect(stage.deals.every(deal => result.entries.some(entry => entry.id === deal.id))).toBe(true);
    }
    expect(result.diagnosticReasonsByDeal.get('win6')?.join(' ')).not.toContain('sem qualificação');
  });

  it('preserves a manual entry gain without Q and keeps outside-entry gains a different category', () => {
    const manual = gain('manual');
    const old = gain('old');
    const result = calculate([manual, old], [], [entry(manual)]);
    expect(ids(result.wonDeals)).toEqual(['manual', 'old']);
    expect(ids(result.entryWonDeals)).toEqual(['manual']);
    expect(ids(result.unqualifiedWonDeals)).toEqual(['manual']);
    expect(ids(result.outsideEntryWonDeals)).toEqual(['old']);
    expect(result.cohortWonDeals).toEqual([]);
    expect(result.closingRate).toBeNull();
    expect(result.totalConversionRate).toBe(100);
  });

  it('does not reinterpret raw outside-entry qualification metadata or label it as unqualified', () => {
    const old = gain('old');
    const result = calculate([old], [], [lifecycle(old, 'qualified', '2026-07-05T12:00:00Z', { stageId: 'q' })]);
    expect(result.qualifiedDeals).toEqual([]);
    expect(result.qualificationDates.has(old.id)).toBe(false);
    expect(result.leadQualificationDates.has(old.id)).toBe(false);
    expect(result.qualificationEvidenceByDeal.has(old.id)).toBe(false);
    expect(result.unqualifiedWonDeals).toEqual([]);
    expect(result.leadSourceTotal).toBe(0);
    expect(result.totalConversionRate).toBeNull();
  });

  it('uses recorded closedAt rather than CUSTOMER visit and never invents a missing closure date', () => {
    const current = gain('current');
    const undated = gain('undated', { closedAt: undefined });
    const result = calculate([current, undated], [movement(current.id, 'signed', '2026-07-25T12:00:00Z'), movement(undated.id, 'signed')]);
    expect(ids(result.wonDeals)).toEqual(['current']);
    expect(result.wonDeals[0].closedAt).toBe(current.closedAt);
    expect(result.entryFunnel.stages.find(stage => stage.milestone === 'customer')!.evidenceByDeal.get(current.id)).toEqual({
      kind: 'win', date: current.closedAt, stageName: 'Ganho registrado', observedAtStage: false,
    });
  });

  it('keeps Q after gain out of the closing numerator using microseconds', () => {
    const before = gain('before', { closedAt: '2026-08-15T12:00:00.000200Z' });
    const after = gain('after', { closedAt: '2026-08-15T12:00:00.000100Z' });
    const result = calculate([before, after], [], [entry(before), entry(after),
      lifecycle(before, 'qualified', '2026-08-15T12:00:00.000100Z'), lifecycle(after, 'qualified', '2026-08-15T12:00:00.000200Z')]);
    expect(ids(result.wonDeals)).toEqual(['after', 'before']);
    expect(ids(result.qualifiedDeals)).toEqual(['after', 'before']);
    expect(ids(result.cohortWonDeals)).toEqual(['before']);
    expect(ids(result.unqualifiedWonDeals)).toEqual(['after']);
    expect(result.closingRate).toBe(50);
  });

  it('preserves the baseline protection against qualified-loss dates and terminal-loss rank', () => {
    const date = '2026-08-03T12:00:00.441874Z';
    const deal = lead('falseQ', { isLost: true, status: 'lost', closedAt: date, qualifiedAt: date, qualificationDateSource: 'transition', lossCategory: 'qualified' });
    const ledger = [entry(deal), lifecycle(deal, 'qualified', date, { source: 'history', snapshotSource: 'current', stageId: undefined })];
    const events = [movement(deal.id, 'lost', date, 'new')];
    const result = calculate([deal], events, ledger);
    expect(result.qualifiedDeals).toEqual([]);
    expect(ids(result.excludedQualificationDeals)).toEqual(['falseQ']);
    expect(result.lostDeals).toEqual(calculate([deal], events, ledger, 'conversion').lostDeals);
  });

  it('shows current post-sale position without dating an arrival, keeping pre-gain evidence unchanged', () => {
    const undocumented = gain('undocumented');
    const advancedLater = gain('later');
    const regressed = gain('regressed', { status: 'signed' });
    const result = calculate([undocumented, advancedLater, regressed], [movement(advancedLater.id, 'won', '2026-09-02T12:00:00Z'), movement(regressed.id, 'won')]);
    const postSale = result.entryFunnel.stages.find(stage => stage.role === 'postcustomer')!;
    expect(ids(postSale.deals)).toEqual(['later', 'undocumented']);
    expect(postSale.evidenceByDeal.get('undocumented')).toEqual({ kind: 'current-stage', date: '', stageName: 'Protocolado', observedAtStage: false });
    expect(postSale.milestoneLabel).toBe('Pós-venda atual');
    expect(result.entries).toEqual([]);
    expect(result.entryFunnel.stages.filter(stage => !stage.role && stage.milestone !== 'customer').every(stage => stage.count === 0)).toBe(true);
  });

  it('does not attribute current outcomes to a former board or accept closure before creation/after cutoff', () => {
    const other = gain('other', { boardId: 'other' });
    const corrupt = gain('corrupt', { createdAt: '2026-09-01T00:00:00Z' });
    const future = gain('future', { closedAt: '2026-09-01T00:00:00Z' });
    expect(calculate([other, corrupt, future]).wonDeals).toEqual([]);
    const early = calculatePerformance([gain('later')], [], board, august, '', undefined, new Date('2026-08-10T12:00:00Z'), { mode: 'monthly' });
    expect(early.wonDeals).toEqual([]);
  });

  it('compares revenue and cycles from retained gains in each period', () => {
    const current = gain('current', { value: 200 });
    const previous = gain('previous', { value: 100, closedAt: '2026-07-15T12:00:00Z' });
    const lost = gain('lost', { isWon: false, isLost: true, closedAt: '2026-07-15T12:00:00Z', value: 900 });
    const result = calculatePerformance([current, previous, lost], [], board, august, '', {
      start: new Date('2026-07-01T00:00:00Z'), end: new Date('2026-07-31T23:59:59.999Z'),
    }, snapshot, { mode: 'monthly' });
    expect(result.wonRevenue).toBe(200);
    expect(result.previousRevenue).toBe(100);
    expect(result.revenueChange).toBe(100);
    expect(result.avgSalesCycle).toBe(45);
  });

  it('uses adjacent ID intersection when the monthly gain population is larger than the entry stage', () => {
    const qualified = lead('q');
    const gains = [gain('a'), gain('b'), gain('c')];
    const compact = { ...board, stages: board.stages.filter(stage => ['new', 'q', 'signed', 'lost'].includes(stage.id)) };
    const result = calculatePerformance([qualified, ...gains], [], compact, august, '', undefined, snapshot, {
      mode: 'monthly', lifecycleEvents: [entry(qualified), lifecycle(qualified, 'qualified', '2026-08-05T12:00:00Z')],
    });
    const stage = result.entryFunnel.stages.find(stage => stage.milestone === 'qualification')!;
    expect(stage.count).toBe(1);
    expect(result.wonDeals).toHaveLength(3);
    expect(stage.conversionRate).toBe(0);
    expect(stage.comparisonBase).toBe('0 também em Assinado ÷ 1 em Proposta enviada');
    expect(result.entryFunnel.stages.find(stage => stage.milestone === 'customer')!.populationLabel).toContain('0 da base de entradas e 3 fora da base');
  });
});
