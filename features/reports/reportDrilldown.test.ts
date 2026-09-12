import { describe, expect, it } from 'vitest';
import { calculatePerformance } from './performanceMetrics';
import { filterReportProducts, NO_PRODUCT, reportDrilldown } from './reportDrilldown';
import type { Board, Deal } from '@/types';

export const board = { id: 'board', name: 'Teste', stages: [
  { id: 'new', label: 'Novo' }, { id: 'q', label: 'Qualificado', linkedLifecycleStage: 'SALES_QUALIFIED' },
  { id: 'won', label: 'Ganho', linkedLifecycleStage: 'CUSTOMER' }, { id: 'lost', label: 'Perdido', linkedLifecycleStage: 'OTHER' },
], wonStageId: 'won', lostStageId: 'lost' } as Board;
const deal = (id: string, extra: Partial<Deal> = {}) => ({ id, title: `Lead ${id}`, boardId: 'board', status: 'new', createdAt: '2026-09-01T12:00:00Z',
  isLost: false, isWon: false, value: 100, items: [{ id: id + '-item', productId: 'p1', name: 'Produto A', quantity: 1, price: 100 }], owner: { name: 'Ana', avatar: '' }, ownerId: 'ana', ...extra } as Deal);
export const reportDeals = [
  deal('entry'),
  deal('old-qualified', { createdAt: '2026-08-01T12:00:00Z', qualifiedAt: '2026-09-02T12:00:00Z', status: 'q' }),
  deal('won', { createdAt: '2026-08-01T12:00:00Z', qualifiedAt: '2026-08-02T12:00:00Z', status: 'won', isWon: true, closedAt: '2026-09-03T12:00:00Z', value: 240, items: [{ id: '1', productId: 'p1', name: 'Produto A', quantity: 1, price: 120 }, { id: '2', productId: 'p2', name: 'Produto B', quantity: 1, price: 120 }] }),
  deal('lost-q', { isLost: true, status: 'lost', closedAt: '2026-09-04T12:00:00Z', lossCategory: 'qualified', lossReason: 'Preço' }),
  deal('lost-dq', { isLost: true, status: 'lost', closedAt: '2026-09-04T12:00:00Z', lossCategory: 'disqualified', lossReason: 'Preço' }),
  deal('unknown', { isLost: true, status: 'lost', closedAt: '2026-09-04T12:00:00Z', items: [] }),
  deal('other-product', { items: [{ id: '3', productId: 'p2', name: 'Produto B', quantity: 1, price: 100 }] }),
];
export const fixture = (deals = reportDeals) => ({ ...calculatePerformance(deals, [], board, { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-30T23:59:59Z') }, '', undefined, new Date('2026-10-01')), deals });

describe('leads que compõem os indicadores', () => {
  it('preserva bases de datas diferentes nas duas taxas', () => {
    const metrics = fixture();
    const qualification = reportDrilldown(metrics, { kind: 'qualification' });
    expect(qualification.groups[0].deals.map(d => d.id)).toEqual(['old-qualified']);
    expect(qualification.groups[0].deals).toHaveLength(metrics.qualifiedCount);
    expect(qualification.groups[1].deals).toEqual(metrics.entries);
    expect(qualification.groups[1].deals.some(d => d.id === 'old-qualified')).toBe(false);
    const closing = reportDrilldown(metrics, { kind: 'closing' });
    expect(closing.groups[0].deals).toEqual(metrics.wonDeals);
    expect(closing.groups[1].deals).toEqual(qualification.groups[0].deals);
  });
  it('separa o mesmo motivo por categoria e inclui perdas sem classificação', () => {
    expect(reportDrilldown(fixture(), { kind: 'loss', category: 'qualified', reason: 'Preço' }).groups[0].deals.map(d => d.id)).toEqual(['lost-q']);
    expect(reportDrilldown(fixture(), { kind: 'loss', category: 'disqualified', reason: 'Preço' }).groups[0].deals.map(d => d.id)).toEqual(['lost-dq']);
    expect(reportDrilldown(fixture(), { kind: 'loss', category: 'unknown' }).groups[0].deals.map(d => d.id)).toEqual(['unknown']);
    expect(reportDrilldown(fixture(), { kind: 'loss' }).groups[0].deals).toHaveLength(3);
  });
  it('filtra antes do cálculo, sem duplicar faturamento de negócios com vários itens', () => {
    const metrics = fixture(filterReportProducts(reportDeals, 'p1'));
    expect(metrics.wonRevenue).toBe(240);
    expect(metrics.entries).toHaveLength(3);
    expect(metrics.qualificationRate).toBeCloseTo(100 / 3);
    const revenue = reportDrilldown(metrics, { kind: 'revenue' });
    expect(revenue.groups[0].deals.reduce((sum, d) => sum + d.value, 0)).toBe(metrics.wonRevenue);
    expect(filterReportProducts(reportDeals, NO_PRODUCT).map(d => d.id)).toEqual(['unknown']);
    expect(filterReportProducts(reportDeals, 'missing')).toEqual([]);
  });
  it('inclui apenas durações válidas e ganhos do vendedor consultado', () => {
    const metrics = fixture([...reportDeals, deal('bad-cycle', { isWon: true, createdAt: 'data inválida', closedAt: '2026-09-05', ownerId: 'bia' })]);
    expect(reportDrilldown(metrics, { kind: 'cycle' }).groups[0].deals.map(d => d.id)).toEqual(['won']);
    expect(reportDrilldown(metrics, { kind: 'owner', ownerId: 'ana', ownerName: 'Ana' }).groups[0].deals.map(d => d.id)).toEqual(['won']);
  });
});
