import type { Activity } from '@/types';
import type { DealHistory } from './useDealHistory';
export type LeadHistoryPage = { history: DealHistory; activities: Activity[]; nextCursor: string | null };
export type TimelineCursor = { at: string; source: 'activity' | 'event' | 'note'; id: string };
export const leadHistoryKey = (orgId: string, dealId: string) => ['leadHistory', orgId, dealId] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/;
// Date loses database microseconds. Keep the fraction separately for comparisons.
function preciseTime(at: string): bigint {
  const match = at.match(timestamp);
  if (!match || !Number.isFinite(Date.parse(at))) throw new Error('Cursor inválido');
  const [year, month, day] = at.slice(0, 10).split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error('Cursor inválido');
  return BigInt(Math.floor(Date.parse(at) / 1000)) * BigInt(1000000) + BigInt((match[1] ?? '').padEnd(6, '0'));
}
export function compareTimelineItems(a: TimelineCursor, b: TimelineCursor): number {
  const timeA = preciseTime(a.at), timeB = preciseTime(b.at);
  return timeA === timeB ? (a.source === b.source ? b.id.localeCompare(a.id) : b.source.localeCompare(a.source)) : timeA > timeB ? -1 : 1;
}
export const encodeCursor = (cursor: TimelineCursor) => btoa(JSON.stringify(cursor));
export function decodeCursor(raw: string): TimelineCursor {
  try {
    if (raw.length > 512) throw new Error();
    const c = JSON.parse(atob(raw)) as TimelineCursor;
    if (!c || !uuid.test(c.id) || !['activity', 'event', 'note'].includes(c.source) || typeof c.at !== 'string') throw new Error();
    preciseTime(c.at);
    return { id: c.id.toLowerCase(), source: c.source, at: c.at };
  } catch { throw new Error('Cursor inválido'); }
}
export function cursorFilter(cursor: TimelineCursor, source: TimelineCursor['source']): string {
  // Only validated cursor values reach this PostgREST expression.
  const c = decodeCursor(encodeCursor(cursor));
  const sameTime = source < c.source ? `created_at.eq.${c.at}` : source === c.source ? `and(created_at.eq.${c.at},id.lt.${c.id})` : null;
  return `created_at.lt.${c.at}${sameTime ? `,${sameTime}` : ''}`;
}
export function paginateTimeline<T extends TimelineCursor>(rows: T[], cursor: TimelineCursor | null = null) {
  const ordered = rows.filter(row => !cursor || compareTimelineItems(row, cursor) > 0).sort(compareTimelineItems);
  const items = ordered.slice(0, 50);
  return { items, nextCursor: ordered.length > 50 ? encodeCursor(items[items.length - 1]) : null };
}
/** Refresh newest rows without losing rows shifted beyond the new 50-row edge.
 * Loaded older pages retain their original cursor boundary. Authoritative edits
 * and deletes use normal infinite-query revalidation (all loaded pages).
 */
export function mergeLatestPage(fresh: LeadHistoryPage, old: LeadHistoryPage): LeadHistoryPage {
  if (!fresh.nextCursor) return fresh;
  const edge = decodeCursor(fresh.nextCursor);
  const activities = old.activities.filter(a => compareTimelineItems({ id: a.id, source: 'activity', at: old.history.activityMeta[a.id]?.createdAt ?? a.date }, edge) > 0);
  const events = old.history.events.filter(e => compareTimelineItems({ id: e.id, source: 'event', at: e.created_at }, edge) > 0);
  const apiNotes = old.history.apiNotes.filter(n => compareTimelineItems({ id: n.id, source: 'note', at: n.createdAt }, edge) > 0);
  return { ...fresh, activities: [...fresh.activities, ...activities], nextCursor: old.nextCursor, history: { ...fresh.history, activityMeta: { ...old.history.activityMeta, ...fresh.history.activityMeta }, events: [...fresh.history.events, ...events], apiNotes: [...fresh.history.apiNotes, ...apiNotes] } };
}
/** Keep loaded rows while making an unseen burst reachable by explicit paging. */
export function refreshTimelinePages(fresh: LeadHistoryPage, pages: LeadHistoryPage[]): LeadHistoryPage[] {
  if (pages.length <= 1) return [fresh];
  const keys = (page: LeadHistoryPage) => [
    ...page.activities.map(a => `activity:${a.id}`),
    ...page.history.events.map(e => `event:${e.id}`),
    ...page.history.apiNotes.map(n => `note:${n.id}`),
  ];
  const oldKeys = new Set(keys(pages[0]));
  const overlaps = keys(fresh).some(key => oldKeys.has(key));
  const next = [mergeLatestPage(fresh, pages[0]), ...pages.slice(1)];
  if (fresh.nextCursor && !overlaps) {
    // A burst can exceed 50 entries between bounded refreshes. Resume at its
    // new boundary, then traverse toward older rows; the projection dedupes
    // any already-loaded rows encountered during this catch-up.
    next[next.length - 1] = { ...next[next.length - 1], nextCursor: fresh.nextCursor };
  }
  return next;
}
