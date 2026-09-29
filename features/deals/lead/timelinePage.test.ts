import { describe, it, expect } from 'vitest';
import { decodeCursor, encodeCursor, compareTimelineItems, paginateTimeline } from './timelinePage';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
describe('timeline cursor', () => {
  it('pages tied timestamps across sources without losing or duplicating rows', () => {
    const rows = Array.from({ length: 153 }, (_, n) => ({ id: id(n), source: ['activity', 'event', 'note'][n % 3] as 'activity' | 'event' | 'note', at: '2026-09-01T10:00:00.123456+00:00' }));
    const allPages: typeof rows = [];
    let cursor = null;
    do {
      const page = paginateTimeline(rows, cursor);
      expect(page.items.length).toBeLessThanOrEqual(50);
      allPages.push(...page.items);
      cursor = page.nextCursor ? decodeCursor(page.nextCursor) : null;
    } while (cursor);
    expect(allPages).toHaveLength(153);
    expect(new Set(allPages.map(item => `${item.source}:${item.id}`)).size).toBe(allPages.length);
  });
  it('retains sub-millisecond precision and accepts equivalent timestamp offsets', () => {
    const a = { id: id(1), source: 'activity' as const, at: '2026-09-01T10:00:00.123457Z' };
    const b = { ...a, at: '2026-09-01T06:00:00.123456-04:00' };
    expect(compareTimelineItems(a, b)).toBeLessThan(0);
    expect(decodeCursor(encodeCursor(a))).toEqual(a);
  });
  it('rejects malformed filters and cursors', () => {
    for (const raw of ['bad', btoa(JSON.stringify({ id: 'or(id.gt.1)', source: 'note', at: 'yesterday' }))]) expect(() => decodeCursor(raw)).toThrow();
  });
});

import { mergeLatestPage, refreshTimelinePages, type LeadHistoryPage } from './timelinePage';
it('preserves shifted rows when refreshing first page with older history loaded', () => {
  const mk = (from: number, to: number): LeadHistoryPage => ({ activities: [], history: { available: true, since: null, activityMeta: {}, apiNotes: [], events: Array.from({ length: to - from }, (_, i) => ({ id: id(i + from), created_at: '2026-09-01T10:00:00.123456Z', kind: 'stage', actor_kind: 'system', actor_id: null, actor_name: null, detail: null, field: null, old_value: null, new_value: null })) }, nextCursor: encodeCursor({ id: id(from), source: 'event', at: '2026-09-01T10:00:00.123456Z' }) });
  const old = mk(50, 100), fresh = mk(55, 105);
  const merged = mergeLatestPage(fresh, old);
  expect(merged.history.events).toHaveLength(55);
  expect(new Set(merged.history.events.map(e => e.id)).size).toBe(55);
  expect(merged.nextCursor).toBe(old.nextCursor);
});

it('makes every unseen row reachable after a burst larger than one page', () => {
  const rows = Array.from({ length: 220 }, (_, n) => ({ id: id(n), source: 'note' as const, at: '2026-09-01T10:00:00.123456Z' }));
  const toPage = (items: typeof rows, nextCursor: string | null): LeadHistoryPage => ({ activities: [], nextCursor, history: { available: true, since: null, events: [], activityMeta: {}, apiNotes: items.map(r => ({ id: r.id, content: r.id, createdAt: r.at, updatedAt: null, authorName: null })) } });
  const oldFirst = paginateTimeline(rows.slice(0, 120));
  const oldSecond = paginateTimeline(rows.slice(0, 120), decodeCursor(oldFirst.nextCursor!));
  const fresh = paginateTimeline(rows);
  const pages = refreshTimelinePages(toPage(fresh.items, fresh.nextCursor), [toPage(oldFirst.items, oldFirst.nextCursor), toPage(oldSecond.items, oldSecond.nextCursor)]);
  const seen = new Set(pages.flatMap(p => p.history.apiNotes.map(n => n.id)));
  let cursor = pages[pages.length - 1].nextCursor;
  expect(cursor).toBe(fresh.nextCursor);
  while (cursor) { const next = paginateTimeline(rows, decodeCursor(cursor)); next.items.forEach(item => seen.add(item.id)); cursor = next.nextCursor; }
  expect(seen.size).toBe(220);
});
