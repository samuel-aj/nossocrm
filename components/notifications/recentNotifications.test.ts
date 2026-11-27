import { expect, it } from 'vitest';
import { RECENT_DAYS, RECENT_LIMIT, isRecentDate, splitRecent } from './recentNotifications';

const DAY = 86_400_000;

it('treats the last days as recent and anything older as previous', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  expect(isRecentDate(new Date(now - 2 * DAY), RECENT_DAYS, now)).toBe(true);
  expect(isRecentDate(new Date(now - RECENT_DAYS * DAY), RECENT_DAYS, now)).toBe(true);
  expect(isRecentDate(new Date(now - RECENT_DAYS * DAY - 1), RECENT_DAYS, now)).toBe(false);
  expect(isRecentDate(new Date(now - 38 * DAY), RECENT_DAYS, now)).toBe(false);
});

it('keeps every item, in order, when splitting recent from previous', () => {
  const items = Array.from({ length: 9 }, (_, index) => ({ id: index, fresh: index !== 2 && index < 7 }));
  const { recent, older } = splitRecent(items, item => item.fresh);
  expect(recent.map(item => item.id)).toEqual([0, 1, 3, 4, 5]);
  expect(recent).toHaveLength(RECENT_LIMIT);
  expect(older.map(item => item.id)).toEqual([2, 6, 7, 8]);
  expect([...recent, ...older]).toHaveLength(items.length);
});
