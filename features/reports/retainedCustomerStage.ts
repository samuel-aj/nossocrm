import type { Board } from '@/types';
import { firstCustomerStage, isLostBoardStage } from '@/lib/boards/boardOutcome';
import type { EntryFunnelEvidence } from './entryFunnel';
import { compareHistoricalDates, type LifecycleEvent } from './performanceHistory';
import type { StageEvent } from './performanceMetrics';

/** Read historical passages using today's commercial milestone. Only a dated
 * arrival or recorded completion of that exact stage can supply a closing date. */
export function retainedCustomerStage(board: Board, ledger: readonly LifecycleEvent[], movements: readonly StageEvent[]) {
  const evidence = new Map<string, EntryFunnelEvidence>();
  const customer = firstCustomerStage(board);
  if (!customer) return evidence;
  const rank = new Map(board.stages.map((stage, index) => [stage.id, index]));
  const customerIndex = rank.get(customer.id)!;
  const resets = new Map<string, string>();
  const reset = (id: string, date: string) => {
    const previous = resets.get(id);
    if (!previous || compareHistoricalDates(date, previous) > 0) resets.set(id, date);
  };
  const returned = (stageId?: string) => !!stageId && (isLostBoardStage(board, stageId) ||
    (rank.get(stageId) ?? Infinity) < customerIndex);
  // Use the full history. A later reversal invalidates the earlier episode
  // even in an earlier month's report, just as for explicit retained wins.
  for (const event of ledger) {
    if (event.type === 'won' || event.type === 'lost' || event.type === 'reopened' || event.type === 'left_board' ||
      ((event.type === 'entered_board' || event.type === 'stage_changed') && returned(event.stageId))) reset(event.dealId, event.date);
  }
  for (const move of movements) if (returned(move.stageId)) reset(move.dealId, move.date);

  const record = (id: string, date: string, completed: boolean) => {
    const boundary = resets.get(id);
    if (boundary && compareHistoricalDates(date, boundary) <= 0) return;
    const existing = evidence.get(id);
    if (existing) {
      const order = compareHistoricalDates(date, existing.date);
      if (order > 0 || (order === 0 && (completed || existing.observedAtStage))) return;
    }
    evidence.set(id, { kind: completed ? 'stage-completion' : 'stage', stageName: customer.label,
      date, observedAtStage: !completed });
  };
  for (const event of ledger) {
    if (event.stageId === customer.id && event.source === 'transition' && !event.isWon && !event.isLost &&
      (event.type === 'entered_board' || event.type === 'stage_changed' || event.type === 'stage_completed')) {
      record(event.dealId, event.date, event.type === 'stage_completed');
    }
  }
  for (const move of movements) if (move.stageId === customer.id) record(move.dealId, move.date, false);
  return evidence;
}
