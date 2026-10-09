import { describe, expect, it } from 'vitest';
import { activityEvents, calculatePerformance, getStageRules, performanceComparisonRange } from './performanceMetrics';
import { august, board, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';

describe('coorte de criação', () => {
  it('é o padrão: qualificados e ganhos são subconjuntos da mesma coorte', () => {
    const deals = [lead('new'), lead('old', { createdAt: '2026-07-01', isWon: true, closedAt: '2026-08-20' }), lead('win', { isWon: true, closedAt: '2026-08-20' })];
    const data = calculatePerformance(deals, deals.map(deal => movement(deal.id, 'q')), board, august, '', undefined, snapshot,
      { lifecycleEvents: deals.filter(deal => deal.isWon).map(deal => lifecycle(deal, 'won', deal.closedAt!, { stageId: 'signed' })) });
    expect(data.mode).toBe('cohort');
    expect(data.entries.map(deal => deal.id)).toEqual(['new', 'win']);
    expect(data.qualifiedCount).toBe(2);
    expect(data.wonDeals.map(deal => deal.id)).toEqual(['win']);
    expect(data.qualificationRate).toBe(100);
    expect(data.closingRate).toBe(50);
  });
  it('aplica o corte ao menor entre fim do período e snapshot e não usa etapas futuras', () => {
    const a = lead('a', { status: 'won', isWon: true, closedAt: '2026-09-02' });
    const history = [movement('a', 'new', a.createdAt), movement('a', 'q', '2026-08-20'), movement('a', 'won', '2026-09-02')];
    const data = calculatePerformance([a], history, board, august, '', undefined, new Date('2026-08-10'));
    expect(data.cutoffDate).toBe('2026-08-10T00:00:00.000Z');
    expect(data.qualifiedCount).toBe(0);
    expect(data.wonDeals).toHaveLength(0);
    expect(data.stageData.map(stage => stage.count)).toEqual([1, 0, 0, 0, 0]);
    expect(data.unknownQualification).toHaveLength(0);
  });
  it('não inventa visitas intermediárias e regressão não apaga as observadas', () => {
    const a = lead('a');
    const history = [movement('a', 'new', a.createdAt), movement('a', 'signed', '2026-08-05', 'new'), movement('a', 'proposal', '2026-08-06', 'signed')];
    const data = calculatePerformance([a], history, board, august, '', undefined, snapshot);
    expect(data.qualifiedCount).toBe(1); // crossing observed, not a visit to MQL
    expect(data.stageData.map(stage => stage.count)).toEqual([1, 0, 1, 1, 0]);
    expect(data.stageData[0].conversionRate).toBe(0);
    expect(data.stageData[1].conversionRate).toBeNull();
  });
  it('ganho sem qualificação comprovada não aumenta o numerador da taxa de fechamento', () => {
    const winner = lead('win', { isWon: true, closedAt: '2026-08-20' });
    const data = calculatePerformance([lead('q'), winner], [movement('q', 'q')], board, august, '', undefined, snapshot,
      { lifecycleEvents: [lifecycle(winner, 'won', winner.closedAt!, { stageId: 'signed' })] });
    expect(data.wonDeals).toHaveLength(1);
    expect(data.qualifiedCount).toBe(1);
    expect(data.cohortWonDeals).toHaveLength(0);
    expect(data.closingRate).toBe(0);
  });
  it('MQL tem prioridade sobre SQL/nome e CUSTOMER define ganho independente do atalho', () => {
    const rules = getStageRules(board);
    expect(rules.steps[rules.qualifiedIndex].id).toBe('q');
    expect(rules.won('signed')).toBe(true);
    expect(rules.won('won')).toBe(false);
    const data = calculatePerformance([lead('a')], [movement('a', 'q')], board, august, '', undefined, snapshot);
    expect(data.hasQualifiedStage).toBe(true);
    expect(data.qualifiedCount).toBe(1);
  });
  it('estimativa não entra na taxa; desconhecido nunca recebe a data atual', () => {
    const deals = [lead('estimated', { status: 'q', qualifiedAt: '2026-08-03', qualificationDateSource: 'estimated' }), lead('unknown', { status: 'q' })];
    const data = calculatePerformance(deals, [], board, august, '', undefined, snapshot, { lifecycleEvents: deals.map(deal => lifecycle(deal, 'entered_board', deal.createdAt, { stageId: 'new' })) });
    expect(data.qualifiedCount).toBe(0);
    expect(data.qualificationRate).toBe(0);
    expect(data.leadQualificationDates.size).toBe(0);
    expect(data.coverage).toMatchObject({ estimatedQualificationCount: 1, unknownQualificationCount: 1 });
  });
  it('aceita data persistida observada e rejeita origens desconhecidas/fora do board', () => {
    const data = calculatePerformance([lead('persisted', { qualifiedAt: '2026-08-02', qualificationDateSource: 'history' }), lead('unknown'), lead('wrong')],
      [{ ...movement('unknown', 'q'), boardId: undefined }, { ...movement('wrong', 'q'), boardId: 'other' }], board, august, '', undefined, snapshot);
    expect([...data.qualifiedIds]).toEqual(['persisted']);
  });
  it('histórico mantém resultado e snapshot apesar de reabertura, transferência e novo responsável/produto', () => {
    const original = lead('a');
    const now = { ...original, boardId: 'other', ownerId: 'bia', value: 999, items: [], isWon: false, status: 'new' };
    const events = [lifecycle(original, 'entered_board', original.createdAt), lifecycle(original, 'qualified', '2026-08-02', { stageId: 'q' }),
      lifecycle(original, 'won', '2026-08-10', { stageId: 'won', value: 250 }), lifecycle(now, 'reopened', '2026-09-10')];
    const data = calculatePerformance([now], [], board, august, 'ana', undefined, snapshot, { lifecycleEvents: events });
    expect(data.entries).toHaveLength(1);
    expect(data.qualificationRate).toBe(100);
    expect(data.closingRate).toBe(100);
    expect(data.wonRevenue).toBe(250);
    expect(data.wonDeals[0]).toMatchObject({ ownerId: 'ana', boardId: 'board', isWon: true, closedAt: '2026-08-10' });
  });
  it('não trata transferência futura para o board como criação nele no passado', () => {
    const a = lead('a');
    const data = calculatePerformance([a], [], board, august, '', undefined, snapshot, { lifecycleEvents: [lifecycle(a, 'entered_board', '2026-09-02')] });
    expect(data.entries).toEqual([]);
  });
  it('reentrada posterior não substitui responsável da primeira presença registrada', () => {
    const original = lead('a');
    const events = [lifecycle(original, 'stage_changed', '2026-08-02', { stageId: 'new' }),
      lifecycle(original, 'left_board', '2026-08-04'), lifecycle(original, 'entered_board', '2026-08-06', { ownerId: 'bia' }),
      lifecycle(original, 'qualified', '2026-08-07', { stageId: 'q', ownerId: 'bia' })];
    const data = calculatePerformance([{ ...original, ownerId: 'bia' }], [], board, august, 'ana', undefined, snapshot, { lifecycleEvents: events });
    expect(data.entries.map(deal => deal.ownerId)).toEqual(['ana']);
    expect(data.qualifiedCount).toBe(1);
  });
});

describe('fluxo e carteira', () => {
  it('fluxo admite eventos de leads antigos, sem dividir populações independentes', () => {
    const a = lead('old', { createdAt: '2026-07-01' });
    const events = [lifecycle(a, 'entered_board', a.createdAt), lifecycle(a, 'qualified', '2026-08-02', { stageId: 'q' }), lifecycle(a, 'won', '2026-08-05', { stageId: 'won' }), lifecycle(a, 'reopened', '2026-08-06'), lifecycle(a, 'won', '2026-08-07', { stageId: 'won', value: 200 })];
    const data = calculatePerformance([a], [movement(a.id, 'q', '2026-08-02'), movement(a.id, 'q', '2026-08-03')], board, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents: events });
    expect(data.entries).toHaveLength(0);
    expect(data.qualifiedCount).toBe(1);
    expect(data.wonDeals).toHaveLength(1);
    expect(data.wonRevenue).toBe(200);
    expect(data.reopenedDeals).toHaveLength(1);
    expect(data.qualificationRate).toBeNull();
    expect(data.closingRate).toBeNull();
    expect(data.stageData[1].count).toBe(1);
    expect(data.stageData.every(stage => stage.conversionRate === null)).toBe(true);
  });
  it('filtro de fluxo usa responsável e produto do acontecimento', () => {
    const a = lead('a');
    const events = [lifecycle(a, 'entered_board', a.createdAt), lifecycle(a, 'won', '2026-08-05', { ownerId: 'bia', items: [{ id: 'b', productId: 'p2', name: 'P2', quantity: 1, price: 300 }], value: 300 })];
    const data = calculatePerformance([a], [], board, august, 'bia', undefined, snapshot, { mode: 'period', lifecycleEvents: events, productId: 'p2' });
    expect(data.entries).toHaveLength(0);
    expect(data.wonRevenue).toBe(300);
  });
  it('qualificação anterior não é repetida quando o lead volta ao MQL', () => {
    const a = lead('a', { createdAt: '2026-07-01' });
    const data = calculatePerformance([a], [movement('a', 'q', '2026-08-03')], board, august, '', undefined, snapshot,
      { mode: 'period', lifecycleEvents: [lifecycle(a, 'qualified', '2026-07-02', { stageId: 'q' })] });
    expect(data.qualifiedCount).toBe(0);
    expect(data.stageData[1].count).toBe(1);
  });
  it('carteira só exibe abertos na etapa atual, sem depender do período e sem taxas', () => {
    const data = calculatePerformance([lead('open', { createdAt: '2026-07-01', status: 'proposal' }), lead('won', { isWon: true }), lead('lost', { isLost: true }), lead('other', { boardId: 'other' })], [], board, august, '', undefined, snapshot, { mode: 'current' });
    expect(data.currentDeals.map(deal => deal.id)).toEqual(['open']);
    expect(data.entries).toEqual(data.currentDeals);
    expect(data.currentValue).toBe(100);
    expect(data.stageData.map(stage => stage.count)).toEqual([0, 0, 1, 0, 0, 0]);
    expect(data.stageData.every(stage => stage.conversionRate === null)).toBe(true);
    expect(data.qualificationRate).toBeNull();
  });
  it('não usa updatedAt para datar fechamento ausente nem soma encerramento inválido', () => {
    const data = calculatePerformance([lead('a', { isLost: true, lossCategory: 'qualified' }), lead('b', { isWon: true, closedAt: '2026-07-01' })], [], board, august, '', undefined, snapshot, { mode: 'period' });
    expect(data.wonDeals).toHaveLength(0);
    expect(data.lostDeals).toHaveLength(0);
    expect(data.coverage.unknownClosureCount).toBe(2);
    expect(data.unknownClosure.map(deal => deal.id)).toEqual(['a', 'b']);
  });
  it('atividades sem board e títulos ambíguos não viram datas observadas', () => {
    const activity = { deal_id: 'a', title: 'Moveu para Proposta enviada', date: '2026-08-01' };
    expect(activityEvents([activity], board)).toEqual([]);
    expect(activityEvents([{ ...activity, board_id: board.id }], board)).toHaveLength(1);
    expect(activityEvents([{ ...activity, board_id: board.id }], { ...board, stages: [...board.stages, { ...board.stages[1], id: 'duplicate' }] })).toEqual([]);
  });
  it('cadastro atual sem prova de presença histórica não inventa entrada', () => {
    const data = calculatePerformance([lead('unknown')], [], board, august, '', undefined, snapshot);
    expect(data.entries).toHaveLength(0);
    expect(data.qualificationRate).toBeNull();
    expect(data.coverage.unknownBoardMembershipCount).toBe(1);
    const flow = calculatePerformance([lead('visited')], [movement('visited', 'q')], board, august, '', undefined, snapshot, { mode: 'period' });
    expect(flow.entries).toHaveLength(0);
    expect(flow.qualifiedCount).toBe(1);
  });
  it('entrada futura impede reatribuir encerramento e qualificação legados ao novo board', () => {
    const a = lead('a', { isWon: true, closedAt: '2026-08-10', qualifiedAt: '2026-08-02', qualificationDateSource: 'history' });
    const data = calculatePerformance([a], [], board, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents: [lifecycle(a, 'entered_board', '2026-09-01')] });
    expect(data.wonDeals).toHaveLength(0);
    expect(data.qualifiedCount).toBe(0);
    expect(data.entries).toHaveLength(0);
  });
  it('regressão de região qualificada não fabrica primeira data observada', () => {
    const a = lead('a', { qualifiedAt: '2026-08-01', qualificationDateSource: 'estimated' });
    const data = calculatePerformance([a], [movement('a', 'q', '2026-08-05', 'proposal')], board, august, '', undefined, snapshot);
    expect(data.qualifiedCount).toBe(0);
    expect(data.leadQualificationDates.size).toBe(0);
    expect(data.stageData[1].count).toBe(1);
  });
  it('etapa terminal de perda não transforma desqualificação em qualificação sem data', () => {
    const disqualified = lead('disqualified', { status: 'lost', isLost: true, closedAt: '2026-08-04', lossCategory: 'disqualified' });
    const qualified = lead('qualified', { status: 'lost', isLost: true, closedAt: '2026-08-04', lossCategory: 'qualified' });
    const data = calculatePerformance([disqualified, qualified], [], board, august, '', undefined, snapshot);
    expect(data.unknownQualification.map(deal => deal.id)).toEqual(['qualified']);
    expect(data.coverage.unknownQualificationCount).toBe(1);
    expect(data.qualifiedCount).toBe(0);
  });
  it('carteira inclui abertos em etapas de desfecho e regras de CUSTOMER coincidem com banco', () => {
    const data = calculatePerformance([lead('open-in-won', { status: 'won' })], [], board, august, '', undefined, snapshot, { mode: 'current' });
    expect(data.stageData.find(stage => stage.stageId === 'won')?.count).toBe(1);
    const customerBoard = { ...board, wonStageId: undefined, linkedLifecycleStage: 'CUSTOMER', stages: board.stages.map(stage => ({ ...stage, linkedLifecycleStage: stage.id === 'won' ? 'CUSTOMER' : stage.linkedLifecycleStage })) };
    expect(getStageRules(customerBoard).won('won')).toBe(false);
    expect(getStageRules({ ...customerBoard, linkedLifecycleStage: 'LEAD' }).won('won')).toBe(true);
    expect(getStageRules({ ...customerBoard, linkedLifecycleStage: 'LEAD' }).won('signed')).toBe(true);
  });
  it('visita usa snapshot exato de estágio, não responsável/produto da entrada nem atuais', () => {
    const original = lead('a');
    const current = { ...original, ownerId: 'carol', items: [] };
    const events = [lifecycle(original, 'entered_board', original.createdAt), lifecycle(original, 'stage_changed', '2026-08-05T12:00:00Z', {
      stageId: 'proposal', ownerId: 'bia', items: [{ id: 'new-product', productId: 'p2', name: 'P2', quantity: 1, price: 100 }],
    })];
    const data = calculatePerformance([current], [movement('a', 'proposal')], board, august, 'bia', undefined, snapshot, { mode: 'period', lifecycleEvents: events, productId: 'p2' });
    expect(data.stageData.find(stage => stage.stageId === 'proposal')?.deals[0]).toMatchObject({ ownerId: 'bia', items: [{ productId: 'p2' }] });
    expect(data.coverage.legacySnapshotCount).toBe(0);
    const withoutExactSnapshot = calculatePerformance([current], [movement('a', 'proposal')], board, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents: events.slice(0, 1) });
    expect(withoutExactSnapshot.coverage.legacySnapshotCount).toBe(1);
  });
  it('coorte usa produto atualmente associado; fluxo usa produto registrado no evento', () => {
    const a = lead('a');
    const events = [lifecycle(a, 'entered_board', a.createdAt, { items: [] }), lifecycle(a, 'qualified', '2026-08-02', { stageId: 'q' }),
      lifecycle(a, 'won', '2026-08-03', { stageId: 'won', items: [{ id: 'old', productId: 'p2', name: 'Anterior', quantity: 1, price: 100 }] })];
    const cohort = calculatePerformance([a], [], board, august, 'ana', undefined, snapshot, { lifecycleEvents: events, productId: 'p1' });
    expect(cohort.entries).toHaveLength(1);
    expect(cohort.qualificationRate).toBe(100);
    expect(cohort.closingRate).toBe(100);
    const period = calculatePerformance([a], [], board, august, 'ana', undefined, snapshot, { mode: 'period', lifecycleEvents: events, productId: 'p1' });
    expect(period.wonDeals).toHaveLength(0);
    const originalProduct = calculatePerformance([a], [], board, august, 'ana', undefined, snapshot, { mode: 'period', lifecycleEvents: events, productId: 'p2' });
    expect(originalProduct.wonDeals).toHaveLength(1);
  });
});

describe('comparação equivalente', () => {
  it('compara o mês em andamento com os mesmos dias do anterior', () => {
    const range = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 9, 23, 59, 59, 999) };
    expect(performanceComparisonRange(range, 'this_month')).toEqual({ start: new Date(2026, 7, 1), end: new Date(2026, 7, 9, 23, 59, 59, 999) });
    expect(performanceComparisonRange(range, 'all')).toBeUndefined();
  });
  it('período completo compara mês completo e mês curto limita o corte', () => {
    expect(performanceComparisonRange({ start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) }, 'last_month')?.end).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
    expect(performanceComparisonRange({ start: new Date(2026, 2, 1), end: new Date(2026, 2, 30) }, 'this_month')?.end).toEqual(new Date(2026, 1, 28, 23, 59, 59, 999));
  });
  it('compara receita usando o mesmo modo e snapshots históricos', () => {
    const prior = lead('prior', { createdAt: '2026-07-01' });
    const current = lead('current');
    const events = [lifecycle(prior, 'entered_board', prior.createdAt), lifecycle(prior, 'won', '2026-07-04', { value: 200 }), lifecycle(current, 'entered_board', current.createdAt), lifecycle(current, 'won', '2026-08-04', { value: 100 })];
    const data = calculatePerformance([prior, current], [], board, august, '', { start: new Date('2026-07-01'), end: new Date('2026-07-31T23:59:59.999Z') }, snapshot, { lifecycleEvents: events });
    expect(data).toMatchObject({ previousRevenue: 200, wonRevenue: 100, revenueChange: -50, avgSalesCycle: 3 });
  });
  it('comparação em andamento usa a mesma hora de corte e mês encerrado mantém mês anterior completo', () => {
    const prior = lead('prior', { createdAt: '2026-07-01' });
    const events = [lifecycle(prior, 'won', '2026-07-08T20:00:00Z', { value: 200 })];
    const range = { start: new Date('2026-08-01'), end: new Date('2026-08-08T23:59:59.999Z') };
    const comparison = { start: new Date('2026-07-01'), end: new Date('2026-07-08T23:59:59.999Z') };
    const data = calculatePerformance([prior], [], board, range, '', comparison, new Date('2026-08-08T12:00:00Z'), { mode: 'period', lifecycleEvents: events });
    expect(data.previousRevenue).toBe(0);
    const priorMonth = lead('end-of-august', { createdAt: '2026-08-01' });
    const full = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
    const complete = calculatePerformance([priorMonth], [], board, full, '', performanceComparisonRange(full, 'last_month'), snapshot,
      { mode: 'period', lifecycleEvents: [lifecycle(priorMonth, 'won', new Date(2026, 7, 31, 12).toISOString(), { value: 200 })] });
    expect(complete.previousRevenue).toBe(200);
  });
});
