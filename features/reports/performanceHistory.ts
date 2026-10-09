import type { Deal, DealItem } from '@/types';
import { getDealLeadSource, normalizeLeadSource } from '@/lib/deals/leadSource';

export type PerformanceMode = 'cohort' | 'period' | 'current' | 'conversion';
export type LifecycleEventType = 'entered_board' | 'left_board' | 'qualified' | 'won' | 'lost' | 'reopened' | 'stage_changed';
export interface LifecycleEvent {
  id: string; dealId: string; boardId: string; type: LifecycleEventType; date: string; recordedAt?: string;
  source: 'transition' | 'history'; snapshotSource: 'transition' | 'current';
  stageId?: string; ownerId?: string; owner?: Deal['owner']; value: number; title: string;
  dealCreatedAt: string; items: DealItem[]; lossCategory?: Deal['lossCategory']; lossReason?: string;
  isWon: boolean; isLost: boolean;
  leadSource?: string | null; leadSourceSnapshotSource?: 'transition' | 'current';
}
export type HistoricalReportDeal = Deal & { leadSourceSnapshotSource?: 'transition' | 'current' };
export interface DbLifecycleEvent {
  id: string; deal_id: string; board_id: string; event_type: LifecycleEventType;
  occurred_at: string; recorded_at?: string | null; source: LifecycleEvent['source']; snapshot_source: LifecycleEvent['snapshotSource'];
  stage_id: string | null; owner_id: string | null; value: number | string; title: string;
  deal_created_at: string; items: unknown; loss_category: Deal['lossCategory'] | null;
  loss_reason: string | null; is_won: boolean; is_lost: boolean;
  lead_source?: string | null; lead_source_snapshot_source?: 'transition' | 'current';
}
export function lifecycleEventFromRow(row: DbLifecycleEvent): LifecycleEvent {
  const items: DealItem[] = Array.isArray(row.items) ? row.items.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    return [{ id: String(value.id || ''), productId: String(value.product_id || value.productId || ''),
      name: String(value.name || ''), quantity: Number(value.quantity) || 0, price: Number(value.price) || 0 }];
  }) : [];
  return { id: row.id, dealId: row.deal_id, boardId: row.board_id, type: row.event_type,
    date: row.occurred_at, recordedAt: row.recorded_at || undefined, source: row.source, snapshotSource: row.snapshot_source,
    stageId: row.stage_id || undefined, ownerId: row.owner_id || undefined, value: Number(row.value) || 0,
    title: row.title, dealCreatedAt: row.deal_created_at, items,
    lossCategory: row.loss_category || undefined, lossReason: row.loss_reason || undefined,
    isWon: !!row.is_won, isLost: !!row.is_lost,
    leadSource: normalizeLeadSource(row.lead_source),
    leadSourceSnapshotSource: row.lead_source !== undefined ? row.lead_source_snapshot_source || 'current' : 'current' };
}
/** Snapshot fields deliberately override today's owner, products and outcome. */
export function dealAtEvent(deal: Deal, event: LifecycleEvent): HistoricalReportDeal {
  return { ...deal, boardId: event.boardId, title: event.title, createdAt: event.dealCreatedAt,
    updatedAt: event.date, status: event.stageId || '', ownerId: event.ownerId,
    owner: event.owner || (event.ownerId === deal.ownerId ? deal.owner : { name: event.ownerId ? 'Responsável não disponível' : 'Sem responsável', avatar: '' }),
    value: event.value, items: event.items, isWon: event.type === 'won' || (event.type !== 'reopened' && event.isWon),
    isLost: event.type === 'lost' || (event.type !== 'reopened' && event.isLost),
    closedAt: event.type === 'won' || event.type === 'lost' ? event.date : undefined,
    qualifiedAt: event.type === 'qualified' ? event.date : undefined,
    qualificationDateSource: event.type === 'qualified' ? event.source : undefined,
    lossCategory: event.lossCategory, lossReason: event.lossReason,
    // Explicit null in a snapshot must never read through today's legacy origem.
    leadSource: event.leadSource !== undefined ? normalizeLeadSource(event.leadSource) : getDealLeadSource(deal),
    leadSourceSnapshotSource: event.leadSource !== undefined ? event.leadSourceSnapshotSource || 'current' : 'current' };
}
export function matchesReportFilters(deal: Deal, ownerId: string, productId: string) {
  return (!ownerId || deal.ownerId === ownerId) && (!productId || (productId === '__none__'
    ? !deal.items.some(item => item.productId)
    : deal.items.some(item => item.productId === productId)));
}

interface EpisodeVisit { dealId: string; stageId: string; date: string; fromStageId?: string }
export function compareHistoricalDates(a: string, b: string) {
  const milliseconds = Date.parse(a) - Date.parse(b);
  if (milliseconds) return milliseconds;
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0').slice(0, 9);
  return fraction(a).localeCompare(fraction(b));
}
/** Normalize the whole observed history before slicing a reporting period.
 * Later CUSTOMER/protocol arrivals must not move the first conversion date.
 * Reopening, loss or returning before CUSTOMER permits a new episode.
 */
export function normalizeWonEpisodes(events: LifecycleEvent[], visits: EpisodeVisit[], resetsAtStage: (stageId: string) => boolean,
  customerProofForVisit: (visit: EpisodeVisit) => 'direct' | 'origin' | undefined = () => undefined,
  requiresResetIds: ReadonlySet<string> = new Set()) {
  const timeline: { dealId: string; date: string; recordedAt?: string; reset: boolean; win?: LifecycleEvent; proof?: 'direct' | 'origin' }[] = [];
  for (const event of events) {
    if (event.type === 'won') timeline.push({ dealId: event.dealId, date: event.date, recordedAt: event.recordedAt, reset: false, win: event });
    else if (event.type === 'lost' || event.type === 'reopened' || event.type === 'left_board' ||
      ((event.type === 'stage_changed' || event.type === 'entered_board') && event.stageId && resetsAtStage(event.stageId))) {
      timeline.push({ dealId: event.dealId, date: event.date, recordedAt: event.recordedAt, reset: true });
    } else if ((event.type === 'stage_changed' || event.type === 'entered_board') && event.stageId) {
      const proof = customerProofForVisit({ dealId: event.dealId, date: event.date, stageId: event.stageId });
      if (proof) timeline.push({ dealId: event.dealId, date: event.date, recordedAt: event.recordedAt, reset: false, proof });
    }
  }
  for (const visit of visits) {
    // The ledger supplies ordering and the snapshot for the same arrival.
    if (events.some(event => event.dealId === visit.dealId && event.stageId === visit.stageId &&
      compareHistoricalDates(event.date, visit.date) === 0 && (event.type === 'stage_changed' || event.type === 'entered_board'))) continue;
    if (resetsAtStage(visit.stageId)) timeline.push({ dealId: visit.dealId, date: visit.date, reset: true });
    else {
      const proof = customerProofForVisit(visit);
      if (proof) timeline.push({ dealId: visit.dealId, date: visit.date, reset: false, proof });
    }
  }
  timeline.sort((a, b) => compareHistoricalDates(a.date, b.date) ||
    (a.recordedAt && b.recordedAt ? compareHistoricalDates(a.recordedAt, b.recordedAt) : 0) ||
    Number(b.reset) - Number(a.reset) || Number(!!b.win) - Number(!!a.win) || (a.win?.id || '').localeCompare(b.win?.id || ''));
  const activeWonIds = new Set<string>();
  const activeCustomerIds = new Set<string>();
  const resetIds = new Set<string>();
  const customerSince = new Map<string, string>();
  const wins: LifecycleEvent[] = [];
  for (const event of timeline) {
    if (event.reset) {
      activeWonIds.delete(event.dealId);
      activeCustomerIds.delete(event.dealId);
      customerSince.delete(event.dealId);
      resetIds.add(event.dealId);
    } else if (event.win && !activeWonIds.has(event.dealId) &&
      (!activeCustomerIds.has(event.dealId) || compareHistoricalDates(customerSince.get(event.dealId)!, event.date) === 0) &&
      (!requiresResetIds.has(event.win.id) || resetIds.has(event.dealId))) {
      activeWonIds.add(event.dealId);
      activeCustomerIds.add(event.dealId);
      customerSince.set(event.dealId, event.date);
      resetIds.delete(event.dealId);
      wins.push(event.win);
    } else if (event.proof && (event.proof === 'direct' || !resetIds.has(event.dealId))) {
      if (!activeCustomerIds.has(event.dealId)) customerSince.set(event.dealId, event.date);
      activeCustomerIds.add(event.dealId);
      resetIds.delete(event.dealId);
    }
  }
  return { wins, activeWonIds, activeCustomerIds, resetIds };
}
