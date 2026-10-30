import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDateRange } from '@/features/dashboard/hooks/useDashboardMetrics';
import { EMPTY_PERIOD, matchesPeriod, periodRange, periodSchema } from '@/features/boards/filters/boardFilters';
import { performanceComparisonRange } from './performanceMetrics';

afterEach(() => vi.useRealTimers());

describe('weekly periods shared by reports and pipeline', () => {
  it.each([
    ['2026-10-28', '2026-10-26', '2026-11-01', '2026-10-19', '2026-10-25'],
    ['2026-11-01', '2026-10-26', '2026-11-01', '2026-10-19', '2026-10-25'],
    ['2026-11-02', '2026-11-02', '2026-11-08', '2026-10-26', '2026-11-01'],
    ['2026-01-01', '2025-12-29', '2026-01-04', '2025-12-22', '2025-12-28'],
    ['2024-03-01', '2024-02-26', '2024-03-03', '2024-02-19', '2024-02-25'],
  ])('uses the same Monday–Sunday bounds on %s', (date, start, end, previousStart, previousEnd) => {
    vi.useFakeTimers();
    const now = new Date(`${date}T12:00:00`);
    vi.setSystemTime(now);
    for (const [reportPreset, boardPreset, from, until] of [
      ['this_week', 'thisWeek', start, end],
      ['last_week', 'lastWeek', previousStart, previousEnd],
    ] as const) {
      const range = getDateRange(reportPreset);
      expect(range).toEqual({ start: new Date(`${from}T00:00:00`), end: new Date(`${until}T23:59:59.999`) });
      // Saved pipeline presets remain valid and recalculate dates when reopened.
      const saved = periodSchema.parse({ ...EMPTY_PERIOD, preset: boardPreset });
      expect(periodRange(saved, now)).toEqual({ start: from, end: until });
      const lead = { createdAt: '', isWon: false, isLost: false };
      for (const [instant, included] of [
        [range.start.getTime() - 1, false], [range.start.getTime(), true],
        [range.end.getTime(), true], [range.end.getTime() + 1, false],
      ] as const) {
        expect(matchesPeriod({ ...lead, createdAt: new Date(instant).toISOString() }, saved, now)).toBe(included);
      }
    }
    expect(performanceComparisonRange(getDateRange('this_week'), 'this_week')).toEqual(getDateRange('last_week'));
    const earlier = performanceComparisonRange(getDateRange('last_week'), 'last_week')!;
    expect(earlier.start.getDay()).toBe(1);
    expect(earlier.end.getDay()).toBe(0);
    expect(earlier.end.getTime() + 1).toBe(getDateRange('last_week').start.getTime());
  });

  it('recalculates pinned weeks instead of keeping the dates they were saved on', () => {
    const saved = periodSchema.parse({ ...EMPTY_PERIOD, preset: 'lastWeek' });
    expect(periodRange(saved, new Date(2026, 9, 28))).toEqual({ start: '2026-10-19', end: '2026-10-25' });
    expect(periodRange(saved, new Date(2026, 10, 2))).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  });
});
