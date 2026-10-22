import { describe, expect, it } from 'vitest';
import type { Board, Deal } from '@/types';
import { calculatePerformance, type LifecycleEvent, type PerformanceMode, type PeriodRange, type StageEvent } from './performanceMetrics';
import { board, lead, lifecycle, movement } from './performanceTestFixtures';
import { selectConversionPopulation } from './conversionFunnel';

const salesBoard: Board = { ...board, stages: [...board.stages.slice(0, 4),
  { id: 'review', label: 'Revisão documental', color: '' }, ...board.stages.slice(4)] };
const created = '2026-10-13T12:00:00Z';
const advanced = '2026-10-13T14:00:00.123456Z';
const month = { start: new Date('2026-10-01T00:00:00-04:00'), end: new Date('2026-10-31T23:59:59.999-04:00') };
const day = { start: new Date('2026-10-13T00:00:00-04:00'), end: new Date('2026-10-13T23:59:59.999-04:00') };
const snapshot = new Date('2026-11-01T12:00:00Z');
const ids = (deals: readonly Deal[]) => deals.map(deal => deal.id).sort();
const completed = (deal: Deal, stageId: string, date = advanced, extra: Partial<LifecycleEvent> = {}) =>
  lifecycle(deal, 'stage_completed', date, { id: `completion:${deal.id}:${stageId}:${date}`, stageId, isWon: true, ...extra });
const report = (deals: Deal[], events: LifecycleEvent[], visits: StageEvent[] = [], range: PeriodRange = month,
  mode: PerformanceMode = 'monthly', owner = '', product = '', asOf = snapshot) =>
  calculatePerformance(deals, visits, salesBoard, range, owner, undefined, asOf, { mode, lifecycleEvents: events, productId: product });
const stage = (result: ReturnType<typeof report>, id: string) => result.entryFunnel.stages.find(item => item.stageId === id)!;
function jump(id = 'new-client') {
  const deal = lead(id, { status: 'won', isWon: true, createdAt: created, updatedAt: advanced,
    qualifiedAt: advanced, qualificationDateSource: 'transition', closedAt: advanced, leadSource: 'Google Ads' });
  const events = [
    lifecycle(deal, 'entered_board', created, { stageId: 'new', isWon: false }),
    // Actual AFTER-trigger order: movement, canonical milestones, then completions.
    lifecycle(deal, 'stage_changed', advanced, { stageId: 'won', isWon: true, recordedAt: '2026-10-13T14:00:00.200100Z' }),
    lifecycle(deal, 'qualified', advanced, { stageId: 'won', isWon: true, recordedAt: '2026-10-13T14:00:00.200200Z' }),
    lifecycle(deal, 'won', advanced, { stageId: 'won', recordedAt: '2026-10-13T14:00:00.200300Z' }),
    ...['q', 'proposal', 'signed', 'review'].map((id, index) => completed(deal, id, advanced, {
      recordedAt: `2026-10-13T14:00:00.200${400 + index}Z`,
    })),
  ];
  return { deal, events, visits: [movement(deal.id, 'won', advanced, 'new')] };
}

describe('dated cumulative stage completions', () => {
  it.each(['monthly', 'conversion'] as const)('reads a direct jump with canonical qualification and gain without changing the entry base (%s)', mode => {
    const fixture = jump();
    const original = structuredClone(fixture.deal);
    for (const range of [day, month]) {
      const result = report([fixture.deal], fixture.events, fixture.visits, range, mode);
      expect(ids(result.entries)).toEqual([fixture.deal.id]);
      expect(result.entries[0]).toMatchObject({ status: 'new', isWon: false, updatedAt: created, leadSource: 'Google Ads' });
      expect([result.qualifiedCount, result.wonDeals.length, result.wonRevenue]).toEqual([1, 1, 100]);
      expect([result.qualificationRate, result.closingRate, result.totalConversionRate]).toEqual([100, 100, 100]);
      expect(result.entryFunnel.stages.map(item => item.count)).toEqual([1, 1, 1, 1, 1, 1]);
      expect(stage(result, 'proposal').evidenceByDeal.get(fixture.deal.id)).toEqual({
        kind: 'stage-completion', stageName: 'Contrato', date: advanced, observedAtStage: false,
      });
      expect(stage(result, 'review').evidenceByDeal.get(fixture.deal.id)).toEqual({
        kind: 'stage-completion', stageName: 'Revisão documental', date: advanced, observedAtStage: false,
      });
      expect(stage(result, 'won').evidenceByDeal.get(fixture.deal.id)).toEqual({
        kind: 'stage', stageName: 'Protocolado', date: advanced, observedAtStage: true,
      });
      expect(result.diagnosticsDeals).toEqual([]);
      expect(result).toEqual(report([fixture.deal], [...fixture.events].reverse(), [...fixture.visits].reverse(), range, mode));
    }
    expect(fixture.deal).toEqual(original);
  });

  it('exposes completion evidence in the period entry funnel without creating additional arrivals', () => {
    const fixture = jump();
    const result = report([fixture.deal], fixture.events, fixture.visits, day, 'period');
    expect(result.entries).toHaveLength(1);
    expect(stage(result, 'proposal').evidenceByDeal.get(fixture.deal.id)).toMatchObject({
      kind: 'stage-completion', date: advanced, stageName: 'Contrato', observedAtStage: false,
    });
  });

  it('preserves earlier milestones and completion dates across later movement and duplicate input', () => {
    const fixture = jump('existing-client');
    const qualified = '2026-10-10T12:00:00Z';
    const signed = '2026-10-11T12:00:00Z';
    const deal = { ...fixture.deal, createdAt: '2026-10-09T12:00:00Z', qualifiedAt: qualified, closedAt: signed };
    const events = [
      lifecycle(deal, 'entered_board', deal.createdAt, { stageId: 'new' }),
      lifecycle(deal, 'qualified', qualified, { stageId: 'q' }),
      completed(deal, 'proposal', signed),
      lifecycle(deal, 'stage_changed', signed, { stageId: 'signed', isWon: true }),
      lifecycle(deal, 'won', signed, { stageId: 'signed' }),
      lifecycle(deal, 'stage_changed', advanced, { stageId: 'won', isWon: true }),
      completed(deal, 'review'),
      lifecycle(deal, 'stage_changed', '2026-10-15T12:00:00Z', { stageId: 'won', isWon: true }),
    ];
    const monthly = report([deal], [...events, ...events]);
    expect(monthly.qualificationDates.get(deal.id)).toBe(qualified);
    expect(monthly.wonDeals[0].closedAt).toBe(signed);
    expect(stage(monthly, 'proposal').evidenceByDeal.get(deal.id)?.date).toBe(signed);
    expect(stage(monthly, 'review').evidenceByDeal.get(deal.id)?.date).toBe(advanced);
    expect(monthly.entryFunnel.stages.every(item => item.count === 1)).toBe(true);
    const daily = report([deal], events, [], day);
    expect([daily.entries.length, daily.qualifiedCount, daily.wonDeals.length, daily.wonRevenue]).toEqual([0, 0, 0, 0]);
    expect([stage(daily, 'review').count, stage(daily, 'won').count]).toEqual([1, 1]);
  });

  it('uses each completion timestamp for daily and snapshot cutoffs', () => {
    const fixture = jump();
    const before = report([fixture.deal], fixture.events, fixture.visits, day, 'monthly', '', '', new Date('2026-10-13T13:00:00Z'));
    expect(before.entries).toHaveLength(1);
    expect(before.qualifiedCount).toBe(0);
    expect(before.wonDeals).toEqual([]);
    expect(stage(before, 'review').count).toBe(0);
    const nextDay = { start: new Date('2026-10-14T00:00:00-04:00'), end: new Date('2026-10-14T23:59:59.999-04:00') };
    const after = report([fixture.deal], fixture.events, fixture.visits, nextDay);
    expect([after.entries.length, after.wonDeals.length, stage(after, 'review').count, stage(after, 'won').count]).toEqual([0, 0, 0, 0]);
  });

  it('filters a post-sale completion by its own snapshot, preserving entry source and outcome', () => {
    const fixture = jump();
    const old = { ...fixture.deal, createdAt: '2026-09-01T12:00:00Z', ownerId: 'current-owner', items: [], closedAt: '2026-09-20T12:00:00Z' };
    const events = [completed(old, 'review', advanced, { ownerId: 'at-movement', items: fixture.deal.items, leadSource: 'Meta Ads' })];
    const result = report([old], events, [], day, 'monthly', 'at-movement', 'p1');
    expect(stage(result, 'review').deals[0]).toMatchObject({ ownerId: 'at-movement', leadSource: 'Meta Ads', status: 'review', updatedAt: advanced });
    expect(stage(result, 'review').evidenceByDeal.get(old.id)?.kind).toBe('stage-completion');
    expect([result.entries.length, result.qualifiedCount, result.wonDeals.length, result.leadSourceTotal]).toEqual([0, 0, 0, 0]);
    expect(stage(report([old], events, [], day, 'monthly', 'current-owner'), 'review').count).toBe(0);
    expect(old).toMatchObject({ status: 'won', closedAt: '2026-09-20T12:00:00Z' });
  });

  it('never synthesizes dated completions or gains for legacy jumps, absent history, lost or another board', () => {
    const fixture = jump('foreign');
    const legacy = lead('legacy', { createdAt: created, status: 'won' });
    const lost = lead('lost', { createdAt: created, status: 'lost', isLost: true });
    const noHistory = lead('no-history', { createdAt: created, status: 'won' });
    const events = [
      lifecycle(legacy, 'entered_board', created, { stageId: 'new' }),
      lifecycle(legacy, 'stage_changed', advanced, { stageId: 'won', isWon: false }),
      lifecycle(lost, 'entered_board', created, { stageId: 'new' }),
      lifecycle(lost, 'lost', advanced, { stageId: 'lost' }),
      ...fixture.events.map(event => ({ ...event, boardId: 'another-board' })),
    ];
    const result = report([legacy, lost, noHistory, { ...fixture.deal, boardId: 'another-board' }], events);
    expect(ids(result.entries)).toEqual(['legacy', 'lost']);
    expect([result.qualifiedCount, result.wonDeals.length, stage(result, 'review').count]).toEqual([0, 0, 0]);
    expect(ids(stage(result, 'won').deals)).toEqual(['legacy']);
  });

  it('does not treat a completion as a reset that permits a repeated canonical win', () => {
    const fixture = jump();
    const events = [...fixture.events,
      lifecycle(fixture.deal, 'won', '2026-10-14T12:00:00Z', { stageId: 'won', value: 999 }),
      lifecycle(fixture.deal, 'stage_changed', '2026-10-14T13:00:00Z', { stageId: 'won', isWon: true }),
    ];
    const result = report([fixture.deal], events, fixture.visits, month, 'conversion');
    expect(result.wonDeals).toHaveLength(1);
    expect(result.wonDeals[0]).toMatchObject({ closedAt: advanced, value: 100 });
    expect(stage(result, 'won').count).toBe(1);
    expect(result.diagnosticsDeals).toEqual([]);
  });

  it('keeps a subsequently lost lead out of retained gains and post-sale counts', () => {
    const fixture = jump();
    const lostAt = '2026-10-14T12:00:00Z';
    const deal = { ...fixture.deal, status: 'lost', isLost: true, isWon: false, closedAt: lostAt };
    const result = report([deal], [...fixture.events, lifecycle(deal, 'lost', lostAt, { stageId: 'lost' })], fixture.visits);
    expect([result.entries.length, result.qualifiedCount]).toEqual([1, 1]);
    expect([result.wonDeals.length, result.wonRevenue, stage(result, 'review').count, stage(result, 'won').count]).toEqual([0, 0, 0, 0]);
  });

  it('never establishes an entry or canonical milestones from isolated completions', () => {
    const deal = lead('completion-only', { createdAt: created, status: 'won' });
    const events = [completed(deal, 'q', advanced, { isWon: false }), completed(deal, 'review', advanced, { isWon: false })];
    for (const mode of ['monthly', 'conversion', 'period', 'cohort'] as const) {
      const result = report([deal], events, [], day, mode);
      expect([result.entries.length, result.qualifiedCount, result.wonDeals.length, result.leadSourceTotal]).toEqual([0, 0, 0, 0]);
    }
  });

  it('does not use an earlier cumulative transaction to authorize a post-sale arrival after reentry', () => {
    const fixture = jump();
    const reentered = '2026-10-14T12:00:00Z';
    const later = '2026-10-14T14:00:00Z';
    const nextDay = { start: new Date('2026-10-14T00:00:00-04:00'), end: new Date('2026-10-14T23:59:59.999-04:00') };
    const deal = { ...fixture.deal, isWon: false, closedAt: undefined };
    const events = [...fixture.events,
      lifecycle(deal, 'reopened', reentered, { stageId: 'new' }),
      lifecycle(deal, 'entered_board', reentered, { stageId: 'new' }),
      lifecycle(deal, 'stage_changed', later, { stageId: 'won', isWon: false }),
    ];
    const result = report([deal], events, [], nextDay, 'conversion');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].updatedAt).toBe(reentered);
    expect([result.wonDeals.length, stage(result, 'review').count, stage(result, 'won').count]).toEqual([0, 0, 0]);
  });

  it.each(['before-gain', 'after-gain'] as const)('preserves an explicit reset within the same occurred_at (%s)', resetPosition => {
    const fixture = jump();
    const resetRecordedAt = resetPosition === 'before-gain' ? '2026-10-13T14:00:00.200150Z' : '2026-10-13T14:00:00.200500Z';
    const visitRecordedAt = resetPosition === 'before-gain' ? '2026-10-13T14:00:00.200100Z' : '2026-10-13T14:00:00.200600Z';
    const events = [...fixture.events, lifecycle(fixture.deal, 'reopened', advanced, { stageId: 'new', recordedAt: resetRecordedAt })];
    if (resetPosition === 'after-gain') events.push(lifecycle(fixture.deal, 'stage_changed', advanced, {
      id: 'post-reset-visit', stageId: 'won', isWon: false, recordedAt: visitRecordedAt,
    }));
    const selected = selectConversionPopulation({ boardId: salesBoard.id, stageIds: salesBoard.stages.map(item => item.id),
      qualifiedStageId: 'q', customerStageId: 'signed', usesCustomerPromotion: true, lost: id => id === 'lost',
      entryEvents: events.filter(event => event.type === 'entered_board'), events, visits: [], cutoffDate: month.end.toISOString() });
    expect(selected.postCustomerVisits.some(visit => visit.stageId === 'won' && visit.recordedAt === visitRecordedAt)).toBe(false);
  });

  it.each([
    { label: 'authoritative won arrival', arrival: { isWon: true }, count: 1 },
    { label: 'open arrival', arrival: { isWon: false }, count: 0 },
    { label: 'reconstructed snapshot', arrival: { isWon: true, snapshotSource: 'current' as const }, count: 0 },
    { label: 'imported history', arrival: { isWon: true, source: 'history' as const }, count: 0 },
  ])('reads a new gain after reopening with an already-recorded prefix: $label', ({ arrival, count }) => {
    const fixture = jump('existing-prefix');
    const qualified = '2026-10-13T12:10:00Z';
    const firstGain = '2026-10-13T12:30:00Z';
    const deal = { ...fixture.deal, qualifiedAt: qualified };
    const events = [
      lifecycle(deal, 'entered_board', created, { stageId: 'new' }),
      lifecycle(deal, 'stage_changed', qualified, { stageId: 'q' }),
      lifecycle(deal, 'qualified', qualified, { stageId: 'q' }),
      lifecycle(deal, 'stage_changed', '2026-10-13T12:20:00Z', { stageId: 'proposal' }),
      lifecycle(deal, 'stage_changed', firstGain, { stageId: 'signed', isWon: true }),
      lifecycle(deal, 'won', firstGain, { stageId: 'signed' }),
      lifecycle(deal, 'stage_changed', '2026-10-13T12:40:00Z', { stageId: 'review', isWon: true }),
      lifecycle(deal, 'reopened', '2026-10-13T13:00:00Z', { stageId: 'signed' }),
      lifecycle(deal, 'stage_changed', advanced, { stageId: 'won', recordedAt: '2026-10-13T14:00:00.200100Z', ...arrival }),
      lifecycle(deal, 'won', advanced, { stageId: 'won', recordedAt: '2026-10-13T14:00:00.200200Z' }),
    ];
    expect(events.some(event => event.type === 'stage_completed')).toBe(false);
    const result = report([deal], events, [], day, 'conversion');
    expect(stage(result, 'won').count).toBe(count);
    expect(result.qualificationDates.get(deal.id)).toBe(qualified);
    expect(result.entries).toHaveLength(1);
    expect(result.wonDeals).toHaveLength(1);
    if (count) expect(result.diagnosticsDeals).toEqual([]);
  });

  it.each([
    { label: 'historical repair with original snapshot', completionSnapshot: 'transition' as const, includeCompletion: true, completionWon: true, converted: 1 },
    { label: 'reconstructed completion snapshot', completionSnapshot: 'current' as const, includeCompletion: true, completionWon: true, converted: 0 },
    { label: 'historical gain without completion evidence', completionSnapshot: 'transition' as const, includeCompletion: false, completionWon: true, converted: 0 },
    { label: 'open historical completion', completionSnapshot: 'transition' as const, includeCompletion: true, completionWon: false, converted: 0 },
  ])('preserves a repaired protocol date and immutable open arrival: $label', ({ completionSnapshot, includeCompletion, completionWon, converted }) => {
    const fixture = jump('selective-repair');
    const qualified = '2026-10-13T12:30:00Z';
    const deal = { ...fixture.deal, qualifiedAt: qualified };
    const original = [
      lifecycle(deal, 'entered_board', created, { stageId: 'new', isWon: false }),
      lifecycle(deal, 'qualified', qualified, { stageId: 'q' }),
      lifecycle(deal, 'stage_changed', advanced, { stageId: 'won', isWon: false, recordedAt: '2026-10-13T14:00:00.200100Z' }),
    ];
    const unchanged = structuredClone(original);
    const repair = [lifecycle(deal, 'won', advanced, { stageId: 'won', source: 'history', snapshotSource: 'transition',
      recordedAt: '2026-10-22T12:00:00.100100Z' }),
      ...(includeCompletion ? ['proposal', 'signed', 'review'].map((id, index) => completed(deal, id, advanced, {
        source: 'history', snapshotSource: completionSnapshot, isWon: completionWon, recordedAt: `2026-10-22T12:00:00.100${200 + index}Z`,
      })) : []),
    ];
    for (const range of [day, month]) for (const mode of ['monthly', 'conversion'] as const) {
      const result = report([deal], [...original, ...repair], fixture.visits, range, mode);
      expect([result.entries.length, result.qualifiedCount, result.wonDeals.length, result.wonRevenue]).toEqual([1, 1, 1, 100]);
      expect([result.qualificationRate, result.closingRate, result.totalConversionRate]).toEqual([100, 100, 100]);
      expect(result.entries[0]).toMatchObject({ status: 'new', updatedAt: created, leadSource: 'Google Ads' });
      expect(result.qualificationDates.get(deal.id)).toBe(qualified);
      expect(result.wonDeals[0].closedAt).toBe(advanced);
      expect(stage(result, 'won').count).toBe(mode === 'monthly' ? 1 : converted);
      if (converted) {
        expect(stage(result, 'won').evidenceByDeal.get(deal.id)).toEqual({ kind: 'stage', date: advanced, stageName: 'Protocolado', observedAtStage: true });
        expect(stage(result, 'review').evidenceByDeal.get(deal.id)).toEqual({ kind: 'stage-completion', date: advanced, stageName: 'Revisão documental', observedAtStage: false });
        expect(result.diagnosticsDeals).toEqual([]);
      }
    }
    expect(original).toEqual(unchanged);
  });
});
