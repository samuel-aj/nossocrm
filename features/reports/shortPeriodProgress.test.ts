import { describe, expect, it } from 'vitest';
import { calculatePerformance, type LifecycleEvent, type PeriodRange, type StageEvent } from './performanceMetrics';
import { board, lead, lifecycle, movement } from './performanceTestFixtures';
import type { Deal } from '@/types';

const arrivalDate = '2026-10-19T14:35:42.872213Z';
const arrivalRecordedAt = '2026-10-19T14:35:43.037567Z';
const qualificationRecordedAt = '2026-10-19T14:35:43.054965Z';
const gainDate = '2026-10-20T11:31:45.113853Z';
// Explicit local-day bounds keep the regression independent of the test host's timezone.
const day: PeriodRange = { start: new Date('2026-10-19T00:00:00-04:00'), end: new Date('2026-10-19T23:59:59.999-04:00') };
const month: PeriodRange = { start: new Date('2026-10-01T00:00:00-04:00'), end: new Date('2026-10-31T23:59:59.999-04:00') };
const snapshot = new Date('2026-10-20T16:00:00Z');
const calculate = (deal: Deal, events: LifecycleEvent[], visits: StageEvent[] = [], range = day) =>
  calculatePerformance([deal], visits, board, range, '', undefined, snapshot, { mode: 'monthly', lifecycleEvents: events });
const stage = (report: ReturnType<typeof calculate>, id: string) => report.entryFunnel.stages.find(item => item.stageId === id)!;
const createLead = () => lead('example', { createdAt: '2026-10-19T12:00:00Z', updatedAt: arrivalDate,
  status: 'proposal', qualifiedAt: arrivalDate, qualificationDateSource: 'transition' });
const entered = (deal: Deal) => lifecycle(deal, 'entered_board', deal.createdAt, { stageId: 'new' });

describe('progress in short reporting periods', () => {
  it('includes a contract arrival and qualification from the same transaction without anticipating the next-day gain', () => {
    const deal = { ...createLead(), status: 'signed', isWon: true, closedAt: gainDate, updatedAt: gainDate };
    const events = [
      entered(deal),
      lifecycle(deal, 'stage_changed', arrivalDate, { stageId: 'proposal', recordedAt: arrivalRecordedAt }),
      lifecycle(deal, 'qualified', arrivalDate, { stageId: 'proposal', recordedAt: qualificationRecordedAt }),
      lifecycle(deal, 'stage_changed', gainDate, { stageId: 'signed', isWon: true }),
      lifecycle(deal, 'won', gainDate, { stageId: 'signed' }),
    ];
    const visits = [movement(deal.id, 'proposal', arrivalDate, 'new'), movement(deal.id, 'signed', gainDate, 'proposal')];
    const daily = calculate(deal, events, visits);
    const monthly = calculate(deal, events, visits, month);

    expect(daily.entries.map(item => item.id)).toEqual([deal.id]);
    expect(daily.qualifiedCount).toBe(1);
    expect(stage(daily, 'proposal').deals.map(item => item.id)).toEqual([deal.id]);
    expect(stage(daily, 'proposal').evidenceByDeal.get(deal.id)).toMatchObject({
      kind: 'stage', date: arrivalDate, observedAtStage: true,
    });
    expect(daily.wonDeals).toEqual([]);
    expect(stage(daily, 'signed').count).toBe(0);
    expect([daily.qualificationRate, daily.closingRate, daily.totalConversionRate]).toEqual([100, 0, 0]);

    expect(monthly.entries.map(item => item.id)).toEqual([deal.id]);
    expect(monthly.qualifiedCount).toBe(daily.qualifiedCount);
    expect(stage(monthly, 'proposal').deals.map(item => item.id)).toEqual([deal.id]);
    expect(monthly.wonDeals.map(item => item.id)).toEqual([deal.id]);
    expect(stage(monthly, 'signed').count).toBe(1);
    expect([monthly.qualificationRate, monthly.closingRate, monthly.totalConversionRate]).toEqual([100, 100, 100]);
  });

  it.each([
    ['before', '2026-10-19T14:35:42.872212Z', '2026-10-19T14:35:44Z', 0],
    ['same occurrence, recorded first', arrivalDate, arrivalRecordedAt, 1],
    ['same occurrence, recorded later', arrivalDate, '2026-10-19T14:35:44Z', 1],
    ['after', '2026-10-19T14:35:42.872214Z', arrivalRecordedAt, 1],
  ] as const)('uses occurrence time, preserving microseconds, for a visit %s qualification', (_label, date, recordedAt, count) => {
    const deal = createLead();
    const result = calculate(deal, [
      entered(deal),
      lifecycle(deal, 'qualified', arrivalDate, { stageId: 'q', recordedAt: qualificationRecordedAt }),
      lifecycle(deal, 'stage_changed', date, { stageId: 'proposal', recordedAt }),
    ], [movement(deal.id, 'proposal', date, 'q')]);

    expect(result.entries).toHaveLength(1);
    expect(result.qualifiedCount).toBe(1);
    expect(stage(result, 'proposal').count).toBe(count);
    expect(result.wonDeals).toEqual([]);
  });

  it.each([
    ['before', arrivalRecordedAt, 0],
    ['after', '2026-10-19T14:35:43.070000Z', 1],
  ] as const)('still orders a same-occurrence visit %s the reentry anchor by recorded_at', (_label, recordedAt, count) => {
    const deal = lead('returning-example', { createdAt: '2026-10-18T12:00:00Z', status: 'proposal',
      qualifiedAt: '2026-10-18T13:00:00Z', qualificationDateSource: 'transition' });
    const result = calculate(deal, [
      entered(deal),
      lifecycle(deal, 'qualified', deal.qualifiedAt!, { stageId: 'q' }),
      lifecycle(deal, 'left_board', '2026-10-18T15:00:00Z', { stageId: 'q' }),
      lifecycle(deal, 'stage_changed', arrivalDate, { stageId: 'proposal', recordedAt }),
      lifecycle(deal, 'entered_board', arrivalDate, { stageId: 'q', recordedAt: qualificationRecordedAt }),
    ], [movement(deal.id, 'proposal', arrivalDate, 'q')]);

    expect(result.entries).toHaveLength(1);
    expect(result.qualifiedCount).toBe(1);
    expect([...result.qualificationCarryInIds]).toEqual([deal.id]);
    expect(stage(result, 'proposal').count).toBe(count);
    expect(result.wonDeals).toEqual([]);
  });
});
