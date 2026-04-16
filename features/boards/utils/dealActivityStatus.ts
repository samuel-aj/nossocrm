import type { Activity, DealView } from '@/types';

export type ActivityStatusKind = 'none' | 'overdue' | 'dueSoon' | 'scheduled';

export interface DealActivityStatus {
  kind: ActivityStatusKind;
  /** Pending activity used to derive this status (absent when kind === 'none'). */
  nextActivity?: Activity;
  /**
   * Whole days between today and the activity date (rounded down, ignoring time).
   * Negative when overdue, 0 when today, positive when in the future.
   */
  daysFromToday: number;
  /** Absolute days overdue; 0 for non-overdue states. */
  daysOverdue: number;
}

const TYPES_THAT_COUNT = new Set(['CALL', 'MEETING', 'EMAIL', 'TASK']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight of the given date, local time. */
const startOfDay = (d: Date) => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

/**
 * Returns the earliest pending CALL/MEETING/EMAIL/TASK for the deal.
 * NOTEs and STATUS_CHANGEs are ignored — they're log entries, not follow-ups.
 */
export function computeNextActivity(dealId: string, activities: Activity[]): Activity | undefined {
  let best: Activity | undefined;
  let bestTs = Infinity;
  for (const a of activities) {
    if (a.dealId !== dealId) continue;
    if (a.completed) continue;
    if (!TYPES_THAT_COUNT.has(a.type)) continue;
    const ts = new Date(a.date).getTime();
    if (Number.isNaN(ts)) continue;
    if (ts < bestTs) {
      bestTs = ts;
      best = a;
    }
  }
  return best;
}

export function computeActivityStatus(
  dealId: string,
  activities: Activity[],
  now: Date = new Date()
): DealActivityStatus {
  const next = computeNextActivity(dealId, activities);
  if (!next) {
    return { kind: 'none', daysFromToday: 0, daysOverdue: 0 };
  }

  const activityDay = startOfDay(new Date(next.date));
  const today = startOfDay(now);
  const daysFromToday = Math.floor((activityDay.getTime() - today.getTime()) / MS_PER_DAY);

  if (daysFromToday < 0) {
    return {
      kind: 'overdue',
      nextActivity: next,
      daysFromToday,
      daysOverdue: Math.abs(daysFromToday),
    };
  }

  const diffMs = new Date(next.date).getTime() - now.getTime();
  if (daysFromToday === 0 || (diffMs >= 0 && diffMs <= MS_PER_DAY)) {
    return { kind: 'dueSoon', nextActivity: next, daysFromToday, daysOverdue: 0 };
  }

  return { kind: 'scheduled', nextActivity: next, daysFromToday, daysOverdue: 0 };
}

/**
 * Pre-compute statuses for a list of deals from the activities list.
 * O(D + A) thanks to a single bucketing pass. Use this once per render in
 * Kanban/list views instead of calling computeActivityStatus per-card.
 */
export function computeActivityStatusMap(
  deals: Pick<DealView, 'id'>[],
  activities: Activity[],
  now: Date = new Date()
): Map<string, DealActivityStatus> {
  const byDeal = new Map<string, Activity>();
  for (const a of activities) {
    if (a.completed) continue;
    if (!TYPES_THAT_COUNT.has(a.type)) continue;
    const ts = new Date(a.date).getTime();
    if (Number.isNaN(ts)) continue;
    const current = byDeal.get(a.dealId);
    if (!current || ts < new Date(current.date).getTime()) {
      byDeal.set(a.dealId, a);
    }
  }

  const today = startOfDay(now);
  const result = new Map<string, DealActivityStatus>();
  for (const deal of deals) {
    const next = byDeal.get(deal.id);
    if (!next) {
      result.set(deal.id, { kind: 'none', daysFromToday: 0, daysOverdue: 0 });
      continue;
    }
    const activityDay = startOfDay(new Date(next.date));
    const daysFromToday = Math.floor((activityDay.getTime() - today.getTime()) / MS_PER_DAY);
    if (daysFromToday < 0) {
      result.set(deal.id, {
        kind: 'overdue',
        nextActivity: next,
        daysFromToday,
        daysOverdue: Math.abs(daysFromToday),
      });
      continue;
    }
    const diffMs = new Date(next.date).getTime() - now.getTime();
    if (daysFromToday === 0 || (diffMs >= 0 && diffMs <= MS_PER_DAY)) {
      result.set(deal.id, { kind: 'dueSoon', nextActivity: next, daysFromToday, daysOverdue: 0 });
      continue;
    }
    result.set(deal.id, { kind: 'scheduled', nextActivity: next, daysFromToday, daysOverdue: 0 });
  }
  return result;
}

/**
 * Tailwind classes map per status kind — shared by the icon and optional
 * hotspots elsewhere in the UI (e.g. list rows or timeline headers).
 */
export const ACTIVITY_STATUS_THEME: Record<
  ActivityStatusKind,
  { ring: string; bg: string; text: string; iconBg: string; label: string }
> = {
  none: {
    ring: 'ring-amber-300 dark:ring-amber-500/60',
    bg: 'bg-amber-100 dark:bg-amber-500/20',
    text: 'text-amber-700 dark:text-amber-300',
    iconBg: 'bg-amber-400 dark:bg-amber-500 text-white',
    label: 'Sem atividade agendada',
  },
  overdue: {
    ring: 'ring-red-400 dark:ring-red-500/70',
    bg: 'bg-red-100 dark:bg-red-500/20',
    text: 'text-red-700 dark:text-red-300',
    iconBg: 'bg-red-500 text-white',
    label: 'Atividade atrasada',
  },
  dueSoon: {
    ring: 'ring-orange-300 dark:ring-orange-500/60',
    bg: 'bg-orange-100 dark:bg-orange-500/20',
    text: 'text-orange-700 dark:text-orange-300',
    iconBg: 'bg-orange-500 text-white',
    label: 'Atividade em breve',
  },
  scheduled: {
    ring: 'ring-emerald-300 dark:ring-emerald-500/60',
    bg: 'bg-emerald-100 dark:bg-emerald-500/20',
    text: 'text-emerald-700 dark:text-emerald-300',
    iconBg: 'bg-emerald-500 text-white',
    label: 'Atividade agendada',
  },
};
