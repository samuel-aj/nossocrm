import { describe, expect, it } from 'vitest';
import { activityEvents, calculatePerformance, performanceComparisonRange, type StageEvent } from './performanceMetrics';
import type { Board, Deal } from '@/types';

const board: Board = { id: 'board', name: 'Vendas', createdAt: '2026-01-01', wonStageId: 'won', lostStageId: 'lost', stages: [
  { id: 'new', label: 'Novo Lead', color: '' }, { id: 'q', label: 'Qualificado', color: '' },
  { id: 'proposal', label: 'Proposta', color: '' }, { id: 'won', label: 'Ganho', color: '' }, { id: 'lost', label: 'Perdido', color: '' },
] };
const august = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-31T23:59:59.999Z') };
const deal = (id: string, overrides: Partial<Deal> = {}): Deal => ({ id, title: id, boardId: 'board', status: 'new', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-09-01', isWon: false, isLost: false, value: 100, contactId: '', items: [], tags: [], owner: { name: '', avatar: '' }, probability: 0, priority: 'medium', ...overrides });
const event = (dealId: string, stageId: string, date = '2026-08-15T12:00:00Z', fromStageId?: string): StageEvent => ({ dealId, stageId, date, fromStageId });

describe('Performance por acontecimentos', () => {
  it('qualifica em agosto um lead criado em julho e mantém qualificação após perda', () => {
    const data = calculatePerformance([deal('old', { isLost: true, lossCategory: 'qualified', closedAt: '2026-08-20', status: 'lost' }), deal('new', { createdAt: '2026-08-02' })], [event('old', 'q'), event('old', 'lost', '2026-08-20')], board, august);
    expect(data.entries).toHaveLength(1);
    expect(data.qualifiedCount).toBe(1);
    expect(data.qualificationRate).toBe(100);
    expect(data.lostDeals).toHaveLength(1);
  });
  it('permite 120% de qualificação e usa ganhos / qualificados no fechamento', () => {
    const leads = Array.from({ length: 12 }, (_, i) => deal(String(i), { createdAt: i < 10 ? '2026-08-01' : '2026-07-01', isWon: i < 3, closedAt: i < 3 ? '2026-08-22' : undefined }));
    const data = calculatePerformance(leads, leads.map(d => event(d.id, 'q')), board, august);
    expect(data.qualificationRate).toBe(120);
    expect(data.closingRate).toBe(25);
  });
  it('não requalifica em agosto um lead qualificado em julho que avançou para proposta', () => {
    const data = calculatePerformance([deal('a', { status: 'proposal' })], [event('a', 'q', '2026-07-10'), event('a', 'proposal', '2026-08-10', 'q')], board, august);
    expect(data.qualifiedCount).toBe(0);
    expect(data.stageData.find(s => s.name === 'Proposta')?.count).toBe(1);
    expect(data.unknownQualification).toHaveLength(0);
  });
  it('mantém qualificação em agosto e conta o ganho somente em setembro', () => {
    const leads = [deal('a', { isWon: true, closedAt: '2026-09-10' })];
    expect(calculatePerformance(leads, [event('a', 'q')], board, august).wonDeals).toHaveLength(0);
    const september = { start: new Date('2026-09-01'), end: new Date('2026-09-30T23:59:59Z') };
    const data = calculatePerformance(leads, [event('a', 'q')], board, september);
    expect(data.wonDeals).toHaveLength(1);
    expect(data.qualifiedCount).toBe(0);
    expect(data.closingRate).toBeNull();
  });
  it('não sinaliza histórico ausente quando a qualificação ocorreu depois do período', () => {
    const leads = [deal('a', { createdAt: '2026-08-10', status: 'won', isWon: true, closedAt: '2026-09-07' })];
    const history = [event('a', 'new', '2026-08-10'), event('a', 'q', '2026-09-04'), event('a', 'won', '2026-09-07')];
    const data = calculatePerformance(leads, history, board, august);
    expect(data.entries).toHaveLength(1);
    expect(data.qualifiedCount).toBe(0);
    expect(data.wonDeals).toHaveLength(0);
    expect(data.unknownQualification).toHaveLength(0);
    expect(data.stageData.find(s => s.name === 'Qualificado')?.count).toBe(0);
  });
  it('mostra ganhos no gráfico pela data de fechamento, mesmo sem mudar de etapa', () => {
    const leads = [
      deal('won', { status: 'won', isWon: true, closedAt: '2026-08-20' }),
      deal('stay', { status: 'proposal', isWon: true, closedAt: '2026-08-22' }),
      deal('next', { status: 'won', isWon: true, closedAt: '2026-09-02' }),
    ];
    const data = calculatePerformance(leads, [event('won', 'won'), event('next', 'won')], board, august);
    expect(data.stageData.find(s => s.name === 'Ganho')).toMatchObject({ name: 'Ganho', count: 2, fill: '#22c55e' });
    expect(data.stageData.find(s => s.name === 'Perdido')).toBeUndefined();
    expect(data.wonDeals).toHaveLength(2);
  });
  it('usa cores das etapas e percentuais de volumes sem limitar a 100%', () => {
    const coloredBoard = { ...board, stages: board.stages.map(s => ({ ...s, color: s.id === 'q' ? 'bg-orange-500' : '#a855f7' })) };
    const data = calculatePerformance([deal('a'), deal('b'), deal('c')], [event('a', 'q'), event('a', 'proposal'), event('b', 'proposal')], coloredBoard, august);
    expect(data.stageData.find(s => s.name === 'Qualificado')).toMatchObject({ fill: '#f97316', conversionRate: 200 });
    expect(data.stageData.find(s => s.name === 'Novo Lead')).toMatchObject({ fill: '#a855f7', conversionRate: null });
  });
  it('compara faturamento ganho com o mês anterior completo e calcula ciclos', () => {
    const range = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 9, 23, 59, 59, 999) };
    const previous = performanceComparisonRange(range, 'this_month')!;
    expect(previous.start).toEqual(new Date(2026, 7, 1));
    expect(previous.end).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
    const leads = [deal('prior', { isWon: true, closedAt: '2026-08-02T12:00:00Z', value: 200 }),
      deal('fast', { isWon: true, createdAt: '2026-09-01T12:00:00Z', closedAt: '2026-09-04T12:00:00Z', value: 50 }),
      deal('slow', { isWon: true, createdAt: '2026-08-20T12:00:00Z', closedAt: '2026-09-09T12:00:00Z', value: 50 }),
      deal('open', { value: 9999 })];
    const data = calculatePerformance(leads, [], board, range, '', previous);
    expect(data).toMatchObject({ wonRevenue: 100, previousRevenue: 200, revenueChange: -50, fastestSalesCycle: 3, slowestSalesCycle: 20, avgSalesCycle: 12 });
    expect(calculatePerformance([], [], board, range, '', previous).revenueChange).toBeNull();
    expect(performanceComparisonRange(range, 'all')).toBeUndefined();
  });
  it('não usa perdas desqualificadas no denominador', () => {
    const leads = [deal('q'), deal('win', { isWon: true, closedAt: '2026-08-20' }), deal('lost', { isLost: true, lossCategory: 'disqualified', closedAt: '2026-08-20' })];
    expect(calculatePerformance(leads, [event('q', 'q')], board, august).closingRate).toBe(100);
  });
  it('deduplica múltiplos webhooks, atividades e retornos à mesma etapa', () => {
    const data = calculatePerformance([deal('a')], [event('a', 'q'), event('a', 'q'), event('a', 'new', '2026-08-16'), event('a', 'q', '2026-08-17')], board, august);
    expect(data.qualifiedCount).toBe(1);
    expect(data.stageData.find(s => s.name === 'Qualificado')?.count).toBe(1);
  });
  it('conta salto sobre qualificação somente com origem abaixo dela conhecida', () => {
    const data = calculatePerformance([deal('a'), deal('b', { status: 'proposal' })], [event('a', 'proposal', '2026-08-10', 'new'), event('b', 'proposal')], board, august);
    expect([...data.qualifiedIds]).toEqual(['a']);
    expect(data.stageData.find(s => s.name === 'Qualificado')?.count).toBe(1);
    expect(data.unknownQualification.map(d => d.id)).toEqual(['b']);
  });
  it('não usa updatedAt como fechamento nem lossCategory como data da qualificação', () => {
    const data = calculatePerformance([deal('a', { isLost: true, lossCategory: 'qualified', updatedAt: '2026-08-10' })], [], board, august);
    expect(data.lostDeals).toHaveLength(0);
    expect(data.qualifiedCount).toBe(0);
    expect(data.unknownClosure).toHaveLength(1);
    expect(data.unknownQualification).toHaveLength(1);
  });
  it('isola quadro, responsável e fronteiras do período', () => {
    const data = calculatePerformance([deal('a', { ownerId: 'owner' }), deal('other', { ownerId: 'other' }), deal('board2', { boardId: 'other', ownerId: 'owner' })], [event('a', 'q', '2026-08-01T00:00:00Z'), event('a', 'proposal', '2026-09-01T00:00:00Z'), event('other', 'q'), event('board2', 'q')], board, august, 'owner');
    expect(data.qualifiedCount).toBe(1);
    expect(data.stageData.find(s => s.name === 'Proposta')?.count).toBe(0);
  });
  it('não inventa qualificação em pipelines sem etapa configurada', () => {
    const data = calculatePerformance([deal('a')], [], { ...board, stages: board.stages.filter(s => s.id !== 'q') }, august);
    expect(data.qualificationRate).toBeNull();
    expect(data.closingRate).toBeNull();
  });
  it('ignora atividades de contato e nomes de etapas ambíguos', () => {
    const activities = [{ deal_id: 'a', title: 'Contato promovido para Qualificado', date: '2026-08-01' }, { deal_id: 'a', title: 'Moveu para Qualificado', date: '2026-08-01' }];
    expect(activityEvents(activities, board)).toHaveLength(1);
    expect(activityEvents(activities, { ...board, stages: [...board.stages, { id: 'q2', label: 'Qualificado', color: '' }] })).toHaveLength(0);
  });
});
