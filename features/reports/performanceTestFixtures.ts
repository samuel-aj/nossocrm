import type { Board, Deal } from '@/types';
import type { LifecycleEvent, StageEvent } from './performanceMetrics';
import { getDealLeadSource } from '@/lib/deals/leadSource';
export const board: Board = { id: 'board', name: 'Vendas', createdAt: '2026-01-01', wonStageId: 'won', lostStageId: 'lost', stages: [
  { id: 'new', label: 'Novo', color: 'bg-blue-500' }, { id: 'q', label: 'Proposta enviada', color: 'bg-orange-500', linkedLifecycleStage: 'MQL' },
  { id: 'proposal', label: 'Contrato', color: '#a855f7', linkedLifecycleStage: 'SALES_QUALIFIED' },
  { id: 'signed', label: 'Assinado', color: '', linkedLifecycleStage: 'CUSTOMER' }, { id: 'won', label: 'Protocolado', color: '', linkedLifecycleStage: 'custom-protocol' }, { id: 'lost', label: 'Perdido', color: '' },
] };
export const august = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-31T23:59:59.999Z') };
export const snapshot = new Date('2026-10-08T12:00:00Z');
export const lead = (id: string, extra: Partial<Deal> = {}): Deal => ({
  id, title: id, boardId: board.id, status: 'new', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-10-01',
  ownerId: 'ana', owner: { name: 'Ana', avatar: '' }, isWon: false, isLost: false, value: 100,
  contactId: '', items: [{ id: 'item', productId: 'p1', name: 'Produto 1', quantity: 1, price: 100 }],
  tags: [], priority: 'medium', probability: 0, ...extra,
});
export const movement = (dealId: string, stageId: string, date = '2026-08-05T12:00:00Z', fromStageId?: string): StageEvent => ({ dealId, stageId, date, fromStageId, boardId: board.id });
export const lifecycle = (deal: Deal, type: LifecycleEvent['type'], date: string, extra: Partial<LifecycleEvent> = {}): LifecycleEvent => ({
  id: `${deal.id}:${type}:${date}`, dealId: deal.id, boardId: board.id, type, date, stageId: deal.status,
  source: 'transition', snapshotSource: 'transition', ownerId: deal.ownerId, owner: deal.owner,
  value: deal.value, title: deal.title, dealCreatedAt: deal.createdAt, items: deal.items,
  leadSource: getDealLeadSource(deal), leadSourceSnapshotSource: 'transition',
  lossCategory: deal.lossCategory, lossReason: deal.lossReason, isWon: type === 'won', isLost: type === 'lost', ...extra,
});
