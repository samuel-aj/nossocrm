import type { Notice } from './types';

/** The first feed page contains every unresolved usage notice, including old blocks. */
export function reconcileUsageNotices(history: Notice[], currentFeed: Notice[]): Notice[] {
  const unresolved = currentFeed.filter(notice => notice.category === 'ai_usage');
  return [...unresolved, ...history.filter(notice => notice.category !== 'ai_usage')];
}

export function clearReadNotices(history: Notice[]): Notice[] {
  return history.filter(notice => notice.category === 'ai_usage');
}
