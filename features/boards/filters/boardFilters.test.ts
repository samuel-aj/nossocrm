import { describe, it, expect } from 'vitest';
import { EMPTY_PERIOD, periodRange, matchesPeriod, matchesProduct, periodSchema } from './boardFilters';

describe('board period filters', () => {
  const now = new Date(2026, 0, 10, 12);
  it.each([
    ['today', '2026-01-10', '2026-01-10'], ['yesterday', '2026-01-09', '2026-01-09'],
    ['last7', '2026-01-04', '2026-01-10'], ['last30', '2025-12-12', '2026-01-10'],
    ['lastMonth', '2025-12-01', '2025-12-31'], ['thisMonth', '2026-01-01', '2026-01-31'],
  ] as const)('%s resolves calendar boundaries', (preset, start, end) => {
    expect(periodRange({ ...EMPTY_PERIOD, preset }, now)).toEqual({ start, end });
  });
  it('recomputes a pinned month instead of freezing its dates, including leap years', () => {
    const pinned = { ...EMPTY_PERIOD, preset: 'lastMonth' as const };
    expect(periodRange(pinned, new Date(2024, 2, 15))).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(periodRange(pinned, new Date(2024, 3, 15))).toEqual({ start: '2024-03-01', end: '2024-03-31' });
  });
  const filter = { ...EMPTY_PERIOD, preset: 'lastMonth' as const, closed: true };
  const both = { createdAt: '2025-12-01T00:00:00', closedAt: '2025-12-31T23:59:59.999', isWon: true, isLost: false };
  it('AND requires both dates, OR includes either without duplicate filtering passes', () => {
    expect(matchesPeriod(both, filter, now)).toBe(true);
    const older = { ...both, createdAt: '2025-11-30T23:59:59.999' };
    expect(matchesPeriod(older, filter, now)).toBe(false);
    expect(matchesPeriod(older, { ...filter, logic: 'OR' }, now)).toBe(true);
    expect([both, older].filter(d => matchesPeriod(d, { ...filter, logic: 'OR' }, now))).toHaveLength(2);
  });
  it('uses actual closure for won and lost leads; open/reopened and missing dates do not match closure', () => {
    const closedOnly = { ...filter, created: false };
    expect(matchesPeriod({ ...both, isWon: false, isLost: true }, closedOnly, now)).toBe(true);
    expect(matchesPeriod({ ...both, isWon: false }, closedOnly, now)).toBe(false);
    expect(matchesPeriod({ ...both, closedAt: undefined }, closedOnly, now)).toBe(false);
    expect(matchesPeriod({ ...both, closedAt: '2026-01-01T00:00:00' }, closedOnly, now)).toBe(false);
  });
  it('validates custom dates and requires a date field', () => {
    for (const patch of [{ start: '', end: '' }, { start: '2026-02-30', end: '2026-03-01' }, { start: '2026-04-01', end: '2026-03-01' }]) {
      expect(periodSchema.safeParse({ ...EMPTY_PERIOD, preset: 'custom', ...patch }).success).toBe(false);
    }
    expect(periodSchema.safeParse({ ...EMPTY_PERIOD, created: false }).success).toBe(false);
    const custom = { ...EMPTY_PERIOD, preset: 'custom' as const, start: '2026-02-01', end: '2026-02-28' };
    expect(periodRange(custom, new Date(2027, 3, 1))).toEqual({ start: custom.start, end: custom.end });
  });
  it('matches products by ID, including multiple items', () => {
    expect(matchesProduct([{ productId: 'one' }, { productId: 'two' }], 'two')).toBe(true);
    expect(matchesProduct([{ productId: 'one' }], 'two')).toBe(false);
    expect(matchesProduct([], '')).toBe(true);
  });
});
