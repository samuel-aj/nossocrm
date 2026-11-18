import type { Notice } from './types';

export function isOngoingNotice(notice: Notice): boolean {
  return notice.category === 'ai_usage' || notice.category === 'connection_outage';
}

/** The first feed page contains the currently actionable alerts, including old blocks. */
export function reconcileUsageNotices(history: Notice[], currentFeed: Notice[]): Notice[] {
  const unresolved = currentFeed.filter(isOngoingNotice);
  return [...unresolved, ...history.filter(notice => !isOngoingNotice(notice))];
}

export function clearReadNotices(history: Notice[]): Notice[] {
  return history.filter(isOngoingNotice);
}
