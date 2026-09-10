import { expect, it } from 'vitest';
import { calculatePerformance } from './performanceMetrics';
import type { Board, Deal } from '@/types';

it('lista exatamente a coorte de cada barra e ganhos por encerramento, respeitando board e vendedor', () => {
  const board = { id: 'b', wonStageId: 'won', stages: [
    { id: 'new', label: 'Novo', color: '' }, { id: 'q', label: 'Qualificado', color: '' },
    { id: 'proposal', label: 'Proposta', color: '' }, { id: 'won', label: 'Ganho', color: '' },
  ] } as Board;
  const lead = (id: string, extra: Partial<Deal> = {}) => ({ id, title: id, boardId: 'b', ownerId: 'seller', status: 'proposal', createdAt: '2026-08-02T12:00:00Z', ...extra }) as Deal;
  const metrics = calculatePerformance([
    lead('later'), lead('unknown'), lead('old-won', { createdAt: '2026-07-01', isWon: true, closedAt: '2026-08-15T12:00:00Z' }),
    lead('other-owner', { ownerId: 'other' }), lead('other-board', { boardId: 'other' }),
  ], [
    { dealId: 'later', stageId: 'q', date: '2026-09-02T12:00:00Z' },
    { dealId: 'later', stageId: 'q', date: '2026-09-03T12:00:00Z' },
    { dealId: 'old-won', stageId: 'q', date: '2026-07-10T12:00:00Z' },
  ], board, { start: new Date('2026-08-01'), end: new Date('2026-08-31T23:59:59Z') }, 'seller', undefined, new Date('2026-09-10'));
  for (const stage of metrics.stageData) {
    expect(stage.deals).toHaveLength(stage.count);
    expect(new Set(stage.deals.map(deal => deal.id)).size).toBe(stage.count);
  }
  expect(metrics.stageData.find(stage => stage.stageId === 'q')!.deals.map(deal => deal.id)).toEqual(['later', 'unknown']);
  expect(metrics.stageData.find(stage => stage.stageId === 'won')!.deals.map(deal => deal.id)).toEqual(['old-won']);
  expect(metrics.leadQualificationDates.get('later')).toBe('2026-09-02T12:00:00Z');
  expect(metrics.leadQualificationDates.get('old-won')).toBe('2026-07-10T12:00:00Z');
  expect(metrics.leadQualificationDates.has('unknown')).toBe(false);
  expect(metrics.qualificationDates.size).toBe(0);
});
