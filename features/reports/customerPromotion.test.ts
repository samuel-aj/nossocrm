import { describe, expect, it } from 'vitest';
import { calculatePerformance, getStageRules } from './performanceMetrics';
import { compareHistoricalDates, lifecycleEventFromRow, normalizeWonEpisodes, type DbLifecycleEvent, type LifecycleEvent } from './performanceHistory';
import { august, board, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';
const september = { start: new Date('2026-09-01'), end: new Date('2026-09-30T23:59:59.999Z') };
const all = { start: august.start, end: september.end };

describe('promoção a Cliente, protocolo e episódios', () => {
  it('primeira assinatura mantém mês, responsável, valor e ciclo; protocolo posterior continua visita', () => {
    const a = lead('a', { status: 'won', isWon: true, closedAt: '2026-09-07', ownerId: 'bia', value: 900 });
    const history = [movement('a', 'q', '2026-08-02', 'new'), movement('a', 'signed', '2026-08-06', 'proposal'), movement('a', 'won', '2026-09-07', 'signed')];
    const events = [lifecycle(a, 'entered_board', a.createdAt, { stageId: 'new', ownerId: 'ana' }),
      lifecycle(a, 'stage_changed', '2026-08-06', { stageId: 'signed', ownerId: 'ana', value: 250, isWon: true }),
      lifecycle(a, 'won', '2026-09-07', { stageId: 'won', ownerId: 'bia', value: 900, source: 'history', snapshotSource: 'current' })];
    const cohort = calculatePerformance([a], history, board, all, 'ana', undefined, snapshot, { lifecycleEvents: events });
    expect(cohort.wonDeals).toHaveLength(1);
    expect(cohort.wonDeals[0]).toMatchObject({ closedAt: '2026-08-06', ownerId: 'ana', value: 250 });
    expect(cohort.avgSalesCycle).toBe(5);
    expect(cohort.closingRate).toBe(100);
    const later = calculatePerformance([a], history, board, september, '', undefined, snapshot, { mode: 'period', lifecycleEvents: events });
    expect(later.wonDeals).toHaveLength(0);
    expect(later.wonRevenue).toBe(0);
    expect(later.stageData.find(stage => stage.stageId === 'won')?.count).toBe(1);
  });
  it('duas etapas CUSTOMER não duplicam nem transferem o ganho para o segundo mês', () => {
    const twoCustomerStages = { ...board, stages: board.stages.map(stage => stage.id === 'won' ? { ...stage, linkedLifecycleStage: 'CUSTOMER', label: 'Outro nome' } : stage) };
    const a = lead('a', { status: 'won' });
    const history = [movement('a', 'signed', '2026-08-06', 'proposal'), movement('a', 'won', '2026-09-07', 'signed')];
    const totals = calculatePerformance([a], history, twoCustomerStages, all, '', undefined, snapshot, { mode: 'period' });
    expect(totals.wonDeals.map(deal => deal.closedAt)).toEqual(['2026-08-06']);
    const later = calculatePerformance([a], history, twoCustomerStages, september, '', undefined, snapshot, { mode: 'period' });
    expect(later.wonDeals).toHaveLength(0);
    expect(later.stageData.find(stage => stage.stageId === 'won')?.count).toBe(1);
  });
  it('atalho wonStageId e closed_at antigos de Protocolado não provam assinatura', () => {
    const a = lead('a', { status: 'won', isWon: true, closedAt: '2026-08-10' });
    const data = calculatePerformance([a], [movement('a', 'won', '2026-08-10', 'new')], board, august, '', undefined, snapshot, { mode: 'period' });
    expect(getStageRules(board).won('won')).toBe(false);
    expect(data.wonDeals).toHaveLength(0);
    expect(data.unknownClosure.map(deal => deal.id)).toEqual(['a']);
    expect(data.stageData.find(stage => stage.stageId === 'signed')?.count).toBe(0);
    expect(data.stageData.find(stage => stage.stageId === 'won')?.count).toBe(1);
  });
  it('origem já CUSTOMER prova cliente, mas não permite datar assinatura no protocolo', () => {
    const a = lead('a', { status: 'won', isWon: false });
    const data = calculatePerformance([a], [movement('a', 'won', '2026-09-07', 'signed')], board, august, '', undefined, snapshot, { mode: 'current' });
    expect(data.currentDeals).toHaveLength(0);
    expect(data.wonDeals).toHaveLength(0);
    expect(data.coverage.unknownClosureCount).toBe(1);
  });
  it('carteira fecha CUSTOMER legado sem inventar data; protocolo sem prova permanece aberto', () => {
    const data = calculatePerformance([lead('signed', { status: 'signed' }), lead('protocol', { status: 'won' })], [], board, august, '', undefined, snapshot, { mode: 'current' });
    expect(data.currentDeals.map(deal => deal.id)).toEqual(['protocol']);
    expect(data.unknownClosure.map(deal => deal.id)).toEqual(['signed']);
    expect(data.cutoffDate).toBe(snapshot.toISOString());
  });
  it.each(['reopened', 'lost', 'left_board', 'regression'] as const)('%s encerra episódio e permite nova promoção', reset => {
    const a = lead('a', { status: 'signed' });
    const events = [lifecycle(a, 'won', '2026-08-02', { stageId: 'signed', value: 100 }),
      lifecycle(a, reset === 'regression' ? 'stage_changed' : reset, '2026-08-03', { stageId: reset === 'regression' ? 'proposal' : a.status }),
      lifecycle(a, 'won', '2026-08-04', { stageId: 'signed', value: 300 })];
    const range = { start: new Date('2026-08-04'), end: august.end };
    const data = calculatePerformance([a], [], board, range, '', undefined, snapshot, { mode: 'period', lifecycleEvents: events });
    expect(data.wonDeals.map(deal => deal.closedAt)).toEqual(['2026-08-04']);
    expect(data.wonRevenue).toBe(300);
    const continuing = calculatePerformance([a], [], board, range, '', undefined, snapshot, { mode: 'period', lifecycleEvents: [events[0], events[2]] });
    expect(continuing.wonDeals).toHaveLength(0);
  });
  it('reabertura explícita na mesma etapa mantém carteira aberta até outra promoção', () => {
    const a = lead('a', { status: 'signed' });
    const events = [lifecycle(a, 'won', '2026-08-02', { stageId: 'signed' }), lifecycle(a, 'reopened', '2026-08-03', { stageId: 'signed' })];
    const data = calculatePerformance([a], [], board, august, '', undefined, snapshot, { mode: 'current', lifecycleEvents: events });
    expect(data.currentDeals.map(deal => deal.id)).toEqual(['a']);
    const repromoted = calculatePerformance([a], [movement('a', 'signed', '2026-08-04', 'signed')], board, { start: new Date('2026-08-04'), end: august.end }, '', undefined, snapshot, { mode: 'period', lifecycleEvents: events });
    expect(repromoted.wonDeals.map(deal => deal.closedAt)).toEqual(['2026-08-04']);
  });
  it('snapshot transacional sem ganho impede fallback sintético ao reabrir durante chegada CUSTOMER', () => {
    const a = lead('a', { status: 'signed' });
    const date = '2026-08-04T12:00:00.000000Z';
    const events = [lifecycle(a, 'entered_board', a.createdAt, { stageId: 'new' }),
      lifecycle(a, 'stage_changed', date, { stageId: 'signed', isWon: false, recordedAt: '2026-08-04T12:00:00.000001Z' }),
      lifecycle(a, 'reopened', date, { stageId: 'signed', recordedAt: '2026-08-04T12:00:00.000002Z' })];
    const history = [movement('a', 'signed', date, 'new')];
    const data = calculatePerformance([a], history, board, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents: events });
    expect(data.wonDeals).toHaveLength(0);
    expect(data.wonRevenue).toBe(0);
    expect(data.qualifiedCount).toBe(1);
    expect(data.reopenedDeals).toHaveLength(1);
    expect(data.stageData.find(stage => stage.stageId === 'signed')?.count).toBe(1);
    const current = calculatePerformance([a], history, board, august, '', undefined, snapshot, { mode: 'current', lifecycleEvents: events });
    expect(current.currentDeals.map(deal => deal.id)).toEqual(['a']);
  });
  it('origem protocolo sem evidência anterior conserva primeira promoção desconhecida', () => {
    const a = lead('a', { status: 'signed' });
    const data = calculatePerformance([a], [movement('a', 'signed', '2026-08-08', 'won')], board, august, '', undefined, snapshot, { mode: 'period' });
    expect(data.wonDeals).toHaveLength(0);
    expect(data.unknownClosure.map(deal => deal.id)).toEqual(['a']);
  });
  it('pré -> protocolo custom comprovado -> CUSTOMER é primeira promoção datada', () => {
    const a = lead('a', { status: 'signed' });
    const history = [movement('a', 'won', '2026-08-05', 'new'), movement('a', 'signed', '2026-08-08', 'won')];
    const data = calculatePerformance([a], history, board, august, '', undefined, snapshot, { mode: 'period' });
    expect(data.wonDeals.map(deal => deal.closedAt)).toEqual(['2026-08-08']);
    expect(data.coverage.unknownClosureCount).toBe(0);
  });
  it('preserva ordem de reapertura e nova promoção com occurred_at igual e recorded_at em microssegundos', () => {
    const a = lead('a');
    const date = '2026-08-05T12:00:00.000000Z';
    const recorded = (micro: string) => `2026-08-05T12:00:00.00000${micro}Z`;
    const events = [lifecycle(a, 'stage_changed', date, { id: 'z1', stageId: 'signed', recordedAt: recorded('1'), isWon: true }),
      lifecycle(a, 'won', date, { id: 'z2', stageId: 'signed', recordedAt: recorded('2'), value: 100 }),
      lifecycle(a, 'reopened', date, { id: 'a1', stageId: 'signed', recordedAt: recorded('3') }),
      lifecycle(a, 'stage_changed', date, { id: 'a2', stageId: 'signed', recordedAt: recorded('4'), isWon: true }),
      lifecycle(a, 'won', date, { id: 'a3', stageId: 'signed', recordedAt: recorded('5'), value: 300 })];
    const normalized = normalizeWonEpisodes(events, [], () => false, visit => visit.stageId === 'signed' ? 'direct' : undefined);
    expect(normalized.wins.map(event => event.id)).toEqual(['z2', 'a3']);
    const data = calculatePerformance([a], [], board, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents: events });
    expect(data.wonRevenue).toBe(300);
    expect(compareHistoricalDates(recorded('1'), recorded('2'))).toBeLessThan(0);
  });
  it('boards já CUSTOMER mantêm ganho explícito; sales sem CUSTOMER não converte só pelo atalho', () => {
    const serviceBoard = { ...board, linkedLifecycleStage: 'CUSTOMER' };
    expect(getStageRules(serviceBoard).won('signed')).toBe(false);
    expect(getStageRules(serviceBoard).won('won')).toBe(true);
    const noCustomer = { ...board, stages: board.stages.map(stage => ({ ...stage, linkedLifecycleStage: stage.id === 'signed' ? 'custom-signed' : stage.linkedLifecycleStage })) };
    expect(getStageRules(noCustomer).won('won')).toBe(false);
    const a = lead('a');
    const manual = calculatePerformance([a], [], noCustomer, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents: [lifecycle(a, 'won', '2026-08-02', { stageId: 'proposal' })] });
    expect(manual.wonDeals).toHaveLength(1);
  });
  it('mapeia recorded_at sem perder os microssegundos', () => {
    const date = '2026-08-05T12:00:00.000001+00:00';
    const row = { id: 'event', deal_id: 'a', board_id: 'board', event_type: 'won', occurred_at: date, recorded_at: date,
      source: 'transition', snapshot_source: 'transition', stage_id: 'signed', owner_id: null, value: '100', title: 'A',
      deal_created_at: '2026-08-01', items: [], loss_category: null, loss_reason: null, is_won: true, is_lost: false } satisfies DbLifecycleEvent;
    const mapped: LifecycleEvent = lifecycleEventFromRow(row);
    expect(mapped.recordedAt).toBe(date);
  });
});
