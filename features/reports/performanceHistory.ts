import type { Deal, DealItem } from '@/types';

export type PerformanceMode = 'cohort' | 'period' | 'current';
export type LifecycleEventType = 'entered_board' | 'left_board' | 'qualified' | 'won' | 'lost' | 'reopened' | 'stage_changed';
export interface LifecycleEvent {
  id: string; dealId: string; boardId: string; type: LifecycleEventType; date: string;
  source: 'transition' | 'history'; snapshotSource: 'transition' | 'current';
  stageId?: string; ownerId?: string; owner?: Deal['owner']; value: number; title: string;
  dealCreatedAt: string; items: DealItem[]; lossCategory?: Deal['lossCategory']; lossReason?: string;
  isWon: boolean; isLost: boolean;
}
export interface DbLifecycleEvent {
  id: string; deal_id: string; board_id: string; event_type: LifecycleEventType;
  occurred_at: string; source: LifecycleEvent['source']; snapshot_source: LifecycleEvent['snapshotSource'];
  stage_id: string | null; owner_id: string | null; value: number | string; title: string;
  deal_created_at: string; items: unknown; loss_category: Deal['lossCategory'] | null;
  loss_reason: string | null; is_won: boolean; is_lost: boolean;
}
export function lifecycleEventFromRow(row: DbLifecycleEvent): LifecycleEvent {
  const items: DealItem[] = Array.isArray(row.items) ? row.items.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    return [{ id: String(value.id || ''), productId: String(value.product_id || value.productId || ''),
      name: String(value.name || ''), quantity: Number(value.quantity) || 0, price: Number(value.price) || 0 }];
  }) : [];
  return { id: row.id, dealId: row.deal_id, boardId: row.board_id, type: row.event_type,
    date: row.occurred_at, source: row.source, snapshotSource: row.snapshot_source,
    stageId: row.stage_id || undefined, ownerId: row.owner_id || undefined, value: Number(row.value) || 0,
    title: row.title, dealCreatedAt: row.deal_created_at, items,
    lossCategory: row.loss_category || undefined, lossReason: row.loss_reason || undefined,
    isWon: !!row.is_won, isLost: !!row.is_lost };
}
/** Snapshot fields deliberately override today's owner, products and outcome. */
export function dealAtEvent(deal: Deal, event: LifecycleEvent): Deal {
  return { ...deal, boardId: event.boardId, title: event.title, createdAt: event.dealCreatedAt,
    updatedAt: event.date, status: event.stageId || '', ownerId: event.ownerId,
    owner: event.owner || (event.ownerId === deal.ownerId ? deal.owner : { name: event.ownerId ? 'Responsável não disponível' : 'Sem responsável', avatar: '' }),
    value: event.value, items: event.items, isWon: event.type === 'won' || (event.type !== 'reopened' && event.isWon),
    isLost: event.type === 'lost' || (event.type !== 'reopened' && event.isLost),
    closedAt: event.type === 'won' || event.type === 'lost' ? event.date : undefined,
    qualifiedAt: event.type === 'qualified' ? event.date : undefined,
    qualificationDateSource: event.type === 'qualified' ? event.source : undefined,
    lossCategory: event.lossCategory, lossReason: event.lossReason };
}
export function matchesReportFilters(deal: Deal, ownerId: string, productId: string) {
  return (!ownerId || deal.ownerId === ownerId) && (!productId || (productId === '__none__'
    ? !deal.items.some(item => item.productId)
    : deal.items.some(item => item.productId === productId)));
}
