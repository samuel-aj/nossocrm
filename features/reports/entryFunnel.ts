import type { Deal } from '@/types';
import { compareHistoricalDates, type LifecycleEvent } from './performanceHistory';

export interface EntryFunnelEvidence { stageName: string; date: string; observedAtStage: boolean; kind?: 'stage' | 'qualification' | 'customer' | 'win' | 'current-stage' }
export interface EntryFunnelStage {
  stageId: string; name: string; fill: string; deals: Deal[]; count: number;
  conversionRate: number | null; conversionLabel: string; comparisonBase: string; populationLabel: string;
  milestone?: 'qualification' | 'customer'; milestoneLabel?: string; role?: 'postcustomer';
  countingMethod: 'reached_or_beyond'; evidenceByDeal: Map<string, EntryFunnelEvidence>;
}
export interface EntryFunnel { stages: EntryFunnelStage[]; baseCount: number; unknownStageCount: number }
interface Arrival { dealId: string; boardId?: string; stageId: string; date: string; recordedAt?: string }
interface Stage { stageId: string; name: string; fill: string }
interface EntryFunnelInput {
  entries: readonly Deal[]; entryEvents: readonly LifecycleEvent[];
  stageEvents: readonly Arrival[]; lifecycleEvents: readonly LifecycleEvent[];
  boardId: string; stages: readonly Stage[]; cutoffDate: string;
}
const compareArrivals = (a: { date: string; recordedAt?: string }, b: { date: string; recordedAt?: string }) =>
  compareHistoricalDates(a.date, b.date) || (a.recordedAt && b.recordedAt ? compareHistoricalDates(a.recordedAt, b.recordedAt) : 0);
const arrivalKey = (arrival: Arrival) => `${arrival.dealId}:${arrival.stageId}:${Date.parse(arrival.date)}:${
  (arrival.date.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0').slice(0, 9)}`;

/** Positional progress in the CURRENT configured stage order, not evidence of
 * visiting skipped stages or of qualifying/winning. The caller excludes loss
 * stages from that order and selects entries using the entry-time filters.
 * Reentries, regressions and reopenings never reset the maximum observed here.
 */
export function buildEntryFunnel({ entries, entryEvents, stageEvents, lifecycleEvents, boardId, stages, cutoffDate }: EntryFunnelInput): EntryFunnel {
  const base = new Map(entries.map(deal => [deal.id, deal]));
  const beforeCutoff = (date: string) => Number.isFinite(Date.parse(date)) && compareHistoricalDates(date, cutoffDate) <= 0;
  const anchors = new Map<string, LifecycleEvent>();
  for (const entry of entryEvents) {
    if (entry.type !== 'entered_board' || entry.boardId !== boardId || !base.has(entry.dealId) || !beforeCutoff(entry.date)) continue;
    const previous = anchors.get(entry.dealId);
    if (!previous || compareArrivals(entry, previous) < 0) anchors.set(entry.dealId, entry);
  }
  const rank = new Map(stages.map((stage, index) => [stage.stageId, index]));
  const ledgerArrivals: Arrival[] = lifecycleEvents.flatMap(event =>
    event.boardId === boardId && base.has(event.dealId) && event.stageId &&
      (event.type === 'entered_board' || event.type === 'stage_changed')
      ? [{ dealId: event.dealId, boardId, stageId: event.stageId, date: event.date, recordedAt: event.recordedAt }] : []);
  // The same arrival may exist in both tables. Keep the ledger's recorded_at
  // ordering so an earlier same-transaction visit cannot move past the anchor.
  const recordedKeys = new Set(ledgerArrivals.map(arrivalKey));
  const arrivals: Arrival[] = [...ledgerArrivals,
    ...stageEvents.filter(event => event.boardId === boardId && !recordedKeys.has(arrivalKey(event))),
    ...[...anchors.values()].flatMap(entry => entry.stageId ? [{ dealId: entry.dealId, boardId, stageId: entry.stageId, date: entry.date, recordedAt: entry.recordedAt }] : []),
  ];
  const observed = new Map<string, Map<number, Arrival>>();
  const maxima = new Map<string, number>();
  for (const arrival of arrivals) {
    const anchor = anchors.get(arrival.dealId);
    const index = rank.get(arrival.stageId);
    if (!anchor || index === undefined || !beforeCutoff(arrival.date) || compareArrivals(arrival, anchor) < 0) continue;
    const visits = observed.get(arrival.dealId) || new Map<number, Arrival>();
    const previous = visits.get(index);
    if (!previous || compareArrivals(arrival, previous) < 0) visits.set(index, arrival);
    observed.set(arrival.dealId, visits);
    maxima.set(arrival.dealId, Math.max(maxima.get(arrival.dealId) ?? -1, index));
  }
  return { baseCount: base.size, unknownStageCount: base.size - maxima.size,
    stages: stages.map((stage, index) => {
      const deals: Deal[] = [];
      const evidenceByDeal = new Map<string, EntryFunnelEvidence>();
      for (const [id, deal] of base) {
        const maximum = maxima.get(id);
        if (maximum === undefined || maximum < index) continue;
        const visits = observed.get(id)!;
        const direct = visits.get(index);
        const evidence = direct || visits.get(maximum)!;
        deals.push(deal);
        evidenceByDeal.set(id, { stageName: direct ? stage.name : stages[maximum].name, date: evidence.date, observedAtStage: !!direct });
      }
      return { ...stage, deals, count: deals.length, countingMethod: 'reached_or_beyond', evidenceByDeal,
        conversionRate: null, conversionLabel: '', comparisonBase: '',
        populationLabel: 'Leads que entraram no funil no período e alcançaram esta etapa ou uma posterior até a apuração. Saltos contam como avanço, não como passagem registrada.' };
    }),
  };
}
