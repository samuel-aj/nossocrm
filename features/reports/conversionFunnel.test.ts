import { describe, expect, it } from 'vitest';
import type { Deal } from '@/types';
import { calculatePerformance, type LifecycleEvent, type StageEvent } from './performanceMetrics';
import { august, board, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';

const report = (deals: Deal[], visits: StageEvent[], events: LifecycleEvent[], ownerId = '', productId = '', cutoff = snapshot) =>
  calculatePerformance(deals, visits, board, august, ownerId, undefined, cutoff, { mode: 'conversion', lifecycleEvents: events, productId });
const ids = (deals: Deal[]) => deals.map(deal => deal.id).sort();
const stage = (result: ReturnType<typeof report>, id: string) => result.entryFunnel.stages.find(item => item.stageId === id)!;
function expectConsistent(result: ReturnType<typeof report>) {
  expect(ids(stage(result, 'q').deals)).toEqual(ids(result.qualifiedDeals));
  expect(ids(stage(result, 'signed').deals)).toEqual(ids(result.wonDeals));
  expect(result.cohortWonDeals).toBe(result.wonDeals);
  expect(result.stageData).toBe(result.entryFunnel.stages);
  const base = new Set(result.entries.map(deal => deal.id));
  let previous = base;
  for (const item of result.entryFunnel.stages) {
    expect(item.deals.every(deal => base.has(deal.id) && previous.has(deal.id))).toBe(true);
    expect(item.count).toBe(new Set(item.deals.map(deal => deal.id)).size);
    expect(item.evidenceByDeal.size).toBe(item.count);
    expect(item.conversionRate === null || item.conversionRate >= 0 && item.conversionRate <= 100).toBe(true);
    previous = new Set(item.deals.map(deal => deal.id));
  }
}

describe('conversão com uma única base de entradas e marcos comprovados', () => {
  it('compartilha IDs entre cards, marcos, taxas e faturamento; separa ganhos sem qualificação', () => {
    const deals = ['qualified', 'won', 'no-q', 'open'].map(id => lead(id));
    const old = lead('old', { createdAt: '2026-07-01T00:00:00Z' });
    const [q, won, noQ] = deals;
    const events = [
      ...deals.map(deal => lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'new' })),
      lifecycle(old, 'entered_board', '2026-07-02T12:00:00Z'),
      ...[q, won, old].map(deal => lifecycle(deal, 'qualified', '2026-08-03T12:00:00Z', { stageId: undefined })),
      ...[won, noQ, old].map(deal => lifecycle(deal, 'won', '2026-08-05T12:00:00Z', { stageId: 'signed' })),
      lifecycle(won, 'stage_changed', '2026-08-06T12:00:00Z', { stageId: 'won', isWon: true }),
    ];
    const result = report([...deals, old], [], events);
    expect(ids(result.entries)).toEqual(['no-q', 'open', 'qualified', 'won']);
    expect(ids(result.qualifiedDeals)).toEqual(['qualified', 'won']);
    expect(ids(result.wonDeals)).toEqual(['won']);
    expect([result.qualificationRate, result.closingRate, result.totalConversionRate]).toEqual([50, 50, 25]);
    expect(result.wonRevenue).toBe(100);
    expect(result.avgSalesCycle).toBe(5);
    expect(ids(result.unqualifiedWonDeals)).toEqual(['no-q']);
    expect(ids(result.diagnosticsDeals)).toEqual(['no-q']);
    expect(result.unqualifiedWonDeals[0].closedAt).toBe('2026-08-05T12:00:00Z');
    expect(stage(result, 'q').evidenceByDeal.get('qualified')).toMatchObject({ kind: 'qualification', observedAtStage: false });
    expect(stage(result, 'signed').evidenceByDeal.get('won')?.kind).toBe('customer');
    expect(stage(result, 'signed').milestoneLabel).toBe('Cliente · Ganhos');
    expect(stage(result, 'won').role).toBe('postcustomer');
    expect(stage(result, 'won').count).toBe(1);
    expect(stage(result, 'won').conversionRate).toBeNull();
    expect(stage(result, 'new').comparisonBase).toBe('2 em Proposta enviada ÷ 4 em Novo');
    expectConsistent(result);
  });

  it('congela filtros e snapshot na primeira entrada selecionada; resultados usam seus próprios valores registrados', () => {
    const deal = lead('a', { ownerId: 'bob', value: 900, items: [] });
    const outsider = lead('outside');
    const p1 = lead('template').items;
    const events = [
      lifecycle(deal, 'entered_board', '2026-08-02', { ownerId: 'bob', stageId: 'new', items: p1 }),
      lifecycle(deal, 'entered_board', '2026-08-04', { ownerId: 'ana', stageId: 'new', items: p1, leadSource: 'Primeira' }),
      lifecycle(deal, 'qualified', '2026-08-05', { ownerId: 'bob', stageId: 'q', items: [] }),
      lifecycle(deal, 'won', '2026-08-06', { ownerId: 'bob', stageId: 'signed', items: [], value: 210 }),
      lifecycle(deal, 'entered_board', '2026-08-10', { ownerId: 'ana', stageId: 'new', items: p1, leadSource: 'Depois' }),
      lifecycle(outsider, 'entered_board', '2026-08-02', { ownerId: 'bob', stageId: 'new' }),
      lifecycle(outsider, 'qualified', '2026-08-05', { ownerId: 'ana', stageId: 'q' }),
      lifecycle(outsider, 'won', '2026-08-06', { ownerId: 'ana', stageId: 'signed', value: 1000 }),
      lifecycle(outsider, 'lost', '2026-08-07'),
      lifecycle(outsider, 'reopened', '2026-08-08'),
    ];
    const result = report([deal, outsider], [], events, 'ana', 'p1');
    expect(ids(result.entries)).toEqual(['a']);
    expect(result.entries[0]).toMatchObject({ updatedAt: '2026-08-04', leadSource: 'Primeira', ownerId: 'ana' });
    expect(result.wonDeals[0]).toMatchObject({ ownerId: 'bob', value: 210 });
    expect(result.wonRevenue).toBe(210);
    expect(result.lostDeals).toEqual([]);
    expect(result.reopenedDeals).toEqual([]);
    expectConsistent(result);
  });

  it('confirma qualificação anterior à entrada sem alterar sua data e não aceita cadastro atual como prova', () => {
    const carry = lead('carry', { createdAt: '2026-07-01' });
    const noProof = lead('no-proof', { createdAt: '2026-07-01', status: 'q' });
    const result = report([carry, noProof], [], [
      ...[carry, noProof].map(deal => lifecycle(deal, 'qualified', '2026-07-20', { stageId: 'q' })),
      lifecycle(carry, 'entered_board', '2026-08-02', { stageId: 'q' }),
      lifecycle(noProof, 'entered_board', '2026-08-02', { stageId: 'new' }),
      ...[carry, noProof].map(deal => lifecycle(deal, 'won', '2026-08-05', { stageId: undefined })),
    ]);
    expect(ids(result.qualifiedDeals)).toEqual(['carry']);
    expect(ids(result.wonDeals)).toEqual(['carry']);
    expect([...result.qualificationCarryInIds]).toEqual(['carry']);
    expect(result.qualificationDates.get('carry')).toBe('2026-07-20');
    expect(stage(result, 'q').evidenceByDeal.get('carry')?.date).toBe('2026-07-20');
    expect(ids(result.unqualifiedWonDeals)).toEqual(['no-proof']);
    expectConsistent(result);
  });

  it('exclui o carimbo antigo de perda qualificada sem ressuscitar o qualifiedAt persistido', () => {
    const date = '2026-08-03T12:00:00.000100Z';
    const deal = lead('false-q', { status: 'lost', isLost: true, lossCategory: 'qualified', qualifiedAt: date, qualificationDateSource: 'transition' });
    const visits = [movement(deal.id, 'lost', date, 'new')];
    const entry = lifecycle(deal, 'entered_board', '2026-08-02', { stageId: 'new' });
    const imported = lifecycle(deal, 'qualified', date, { source: 'history', snapshotSource: 'current', stageId: undefined });
    for (const events of [[entry, imported], [entry]]) {
      const result = report([deal], visits, events);
      expect(result.qualifiedDeals).toEqual([]);
      expect(result.qualificationDates.has(deal.id)).toBe(false);
      expect(ids(result.excludedQualificationDeals)).toEqual([deal.id]);
      expect(result.coverage.excludedQualificationCount).toBe(1);
      expect(result.diagnosticReasonsByDeal.get(deal.id)?.[0]).toContain('contradita');
      expectConsistent(result);
    }
  });

  it('uma prova futura não valida o falso carimbo antigo nem um ganho anterior à qualificação verdadeira', () => {
    const deal = lead('later-proof');
    const events = [lifecycle(deal, 'entered_board', '2026-08-02', { stageId: 'new' }),
      lifecycle(deal, 'qualified', '2026-08-03', { source: 'history', snapshotSource: 'current', stageId: undefined }),
      lifecycle(deal, 'reopened', '2026-08-04', { stageId: 'new' }),
      lifecycle(deal, 'won', '2026-08-05', { stageId: undefined }),
    ];
    const result = report([deal], [movement(deal.id, 'lost', '2026-08-03', 'new'), movement(deal.id, 'q', '2026-08-06', 'new')], events);
    expect(result.qualificationDates.get(deal.id)).toBe('2026-08-06');
    expect(result.wonDeals).toEqual([]);
    expect(ids(result.unqualifiedWonDeals)).toEqual([deal.id]);
    expect(ids(result.excludedQualificationDeals)).toEqual([deal.id]);
    expectConsistent(result);
    const beforeRealProof = report([deal], [movement(deal.id, 'lost', '2026-08-03', 'new'), movement(deal.id, 'q', '2026-08-06', 'new')], events, '', '', new Date('2026-08-04'));
    expect(beforeRealProof.qualifiedDeals).toEqual([]);
  });

  it.each(['modern', 'crossing', 'earlier', 'other-board', 'microseconds'] as const)('preserva qualificação legítima: %s', variant => {
    const deal = lead('valid');
    const date = '2026-08-03T12:00:00.000100Z';
    const q = lifecycle(deal, 'qualified', date, { stageId: undefined, source: variant === 'modern' ? 'transition' : 'history', snapshotSource: 'current' });
    const lossDate = variant === 'microseconds' ? '2026-08-03T12:00:00.000200Z' : date;
    const visits = [{ ...movement(deal.id, 'lost', lossDate, 'new'), boardId: variant === 'other-board' ? 'another-board' : board.id }];
    if (variant === 'crossing' || variant === 'earlier') visits.push(movement(deal.id, 'q', variant === 'earlier' ? '2026-08-02T12:00:00Z' : date, 'new'));
    const result = report([deal], visits, [lifecycle(deal, 'entered_board', '2026-08-02', { stageId: 'new' }), q]);
    expect(ids(result.qualifiedDeals)).toEqual([deal.id]);
    expect(result.excludedQualificationDeals).toEqual([]);
    expectConsistent(result);
  });

  it('protocolo sem Cliente continua diagnóstico com etapa/data reais, sem aumentar o marco ou ganho', () => {
    const deal = lead('protocol-only');
    const result = report([deal], [movement(deal.id, 'won', '2026-08-05', 'q')], [
      lifecycle(deal, 'entered_board', '2026-08-02', { stageId: 'new' }),
      lifecycle(deal, 'qualified', '2026-08-03', { stageId: 'q' }),
    ]);
    expect(stage(result, 'proposal').count).toBe(1);
    expect(stage(result, 'signed').count).toBe(0);
    expect(stage(result, 'won').count).toBe(0);
    expect(result.wonDeals).toEqual([]);
    expect(result.diagnosticsDeals[0]).toMatchObject({ status: 'won', updatedAt: '2026-08-05', isWon: false, closedAt: undefined });
    expectConsistent(result);
  });

  it('só aceita pósCliente durante episódio válido, preservando avanços já confirmados antes da reabertura', () => {
    const before = lead('before');
    const after = lead('after');
    const events = [before, after].flatMap(deal => [
      lifecycle(deal, 'entered_board', '2026-08-02', { stageId: 'new' }),
      lifecycle(deal, 'qualified', '2026-08-03', { stageId: 'q' }),
      lifecycle(deal, 'won', '2026-08-04', { stageId: 'signed' }),
      lifecycle(deal, 'reopened', '2026-08-06', { stageId: 'signed' }),
    ]);
    const result = report([before, after], [movement(before.id, 'won', '2026-08-05', 'signed'), movement(after.id, 'won', '2026-08-07', 'signed')], events);
    expect(ids(result.wonDeals)).toEqual(['after', 'before']);
    expect(ids(stage(result, 'won').deals)).toEqual(['before']);
    expect(ids(result.diagnosticsDeals)).toEqual(['after']);
    expectConsistent(result);
  });

  it('novo episódio de ganho não duplica receita/ID e libera progresso posterior', () => {
    const deal = lead('twice');
    const result = report([deal], [], [
      lifecycle(deal, 'entered_board', '2026-08-02', { stageId: 'new' }),
      lifecycle(deal, 'qualified', '2026-08-03', { stageId: undefined }),
      lifecycle(deal, 'won', '2026-08-04', { stageId: undefined, value: 120 }),
      lifecycle(deal, 'reopened', '2026-08-06'),
      lifecycle(deal, 'won', '2026-08-08', { stageId: 'signed', value: 250 }),
      lifecycle(deal, 'stage_changed', '2026-08-09', { stageId: 'won', isWon: true }),
    ]);
    expect(result.wonRevenue).toBe(120);
    expect(result.wonDeals[0].closedAt).toBe('2026-08-04');
    expect(stage(result, 'won').count).toBe(1);
    expectConsistent(result);
  });

  it('respeita âncora, microssegundos, recorded_at, cutoff e outro funil', () => {
    const deal = lead('precise');
    const date = '2026-08-05T12:00:00.000200Z';
    const result = report([deal], [
      movement(deal.id, 'won', date, 'signed'),
      { ...movement(deal.id, 'proposal', '2026-08-06', 'q'), boardId: 'other-board' },
    ], [
      lifecycle(deal, 'stage_changed', date, { stageId: 'won', recordedAt: '2026-08-05T12:00:00.000100Z' }),
      lifecycle(deal, 'entered_board', date, { stageId: 'new', recordedAt: '2026-08-05T12:00:00.000200Z' }),
      lifecycle(deal, 'qualified', '2026-08-05T12:00:00.000300Z', { stageId: 'q' }),
      lifecycle(deal, 'won', '2026-08-08', { stageId: 'signed' }),
    ], '', '', new Date('2026-08-07'));
    expect(ids(result.qualifiedDeals)).toEqual([deal.id]);
    expect(result.wonDeals).toEqual([]);
    expect(result.entryFunnel.stages.map(item => item.count)).toEqual([1, 1, 0, 0, 0]);
    expectConsistent(result);
  });

  it('retorna taxas nulas para denominadores vazios', () => {
    const result = report([], [], []);
    expect([result.qualificationRate, result.closingRate, result.totalConversionRate]).toEqual([null, null, null]);
    expect(result.entryFunnel.stages.every(item => item.conversionRate === null && !item.comparisonBase)).toBe(true);
    expectConsistent(result);
  });

  it('mantém a entrada sem etapa no denominador e no diagnóstico sem inventar a primeira coluna', () => {
    const deal = lead('unknown-stage', { status: 'signed' });
    const result = report([deal], [], [lifecycle(deal, 'entered_board', '2026-08-02', { stageId: undefined })]);
    expect(result.entries).toHaveLength(1);
    expect(ids(result.unknownStageDeals)).toEqual([deal.id]);
    expect(result.entryFunnel.unknownStageCount).toBe(1);
    expect(result.entryFunnel.stages.map(item => item.count)).toEqual([0, 0, 0, 0, 0]);
    expect(result.diagnosticReasonsByDeal.get(deal.id)?.[0]).toContain('sem etapa válida');
    expect(result.qualificationRate).toBe(0);
    expect(result.closingRate).toBeNull();
    expectConsistent(result);
  });

  it.each(['sales-without-customer', 'customer-pipeline'] as const)('descreve encerramento explícito como ganho, sem afirmar promoção a Cliente: %s', kind => {
    const deal = lead('explicit-win');
    const explicitBoard = { ...board, linkedLifecycleStage: kind === 'customer-pipeline' ? 'CUSTOMER' : undefined,
      stages: board.stages.map(item => item.id === 'signed' ? { ...item, linkedLifecycleStage: 'custom-review' } : item) };
    const result = calculatePerformance([deal], [], explicitBoard, august, '', undefined, snapshot, { mode: 'conversion', lifecycleEvents: [
      lifecycle(deal, 'entered_board', '2026-08-02', { stageId: 'new' }),
      lifecycle(deal, 'qualified', '2026-08-03', { stageId: 'q' }),
      lifecycle(deal, 'won', '2026-08-04', { stageId: 'won' }),
    ] });
    expect(result.usesCustomerPromotion).toBe(false);
    expect(result.wonDeals).toHaveLength(1);
    expect(stage(result, 'won').milestone).toBe('customer');
    expect(stage(result, 'won').milestoneLabel).toBe('Ganhos');
    expect(stage(result, 'won').populationLabel).toContain('encerramento explícito comprovado');
    expect(stage(result, 'won').evidenceByDeal.get(deal.id)).toMatchObject({ kind: 'win', stageName: 'Ganho registrado', date: '2026-08-04' });
    expect(stage(result, 'proposal').evidenceByDeal.get(deal.id)?.kind).toBe('win');
    expect(result.entryFunnel.stages.every(item => !item.populationLabel.includes('Cliente'))).toBe(true);
  });

  it('o destino explícito de ganhos não vira ganho automático em vendas sem CUSTOMER', () => {
    const deal = lead('protocol-only');
    const explicitBoard = { ...board, stages: board.stages.map(item => item.id === 'signed' ? { ...item, linkedLifecycleStage: 'custom-review' } : item) };
    const result = calculatePerformance([deal], [movement(deal.id, 'won', '2026-08-04', 'q')], explicitBoard, august, '', undefined, snapshot,
      { mode: 'conversion', lifecycleEvents: [lifecycle(deal, 'entered_board', '2026-08-02', { stageId: 'new' }),
        lifecycle(deal, 'qualified', '2026-08-03', { stageId: 'q' })] });
    expect(result.usesCustomerPromotion).toBe(false);
    expect(result.wonDeals).toEqual([]);
    expect(stage(result, 'won').count).toBe(0);
    expect(stage(result, 'won').milestoneLabel).toBe('Ganhos');
  });

  it('sem etapa de Cliente nem destino de ganho não inventa um marco de promoção', () => {
    const deal = lead('manual-without-destination');
    const explicitBoard = { ...board, wonStageId: undefined,
      stages: board.stages.map(item => item.id === 'signed' ? { ...item, linkedLifecycleStage: 'custom-review' } : item) };
    const result = calculatePerformance([deal], [], explicitBoard, august, '', undefined, snapshot, { mode: 'conversion', lifecycleEvents: [
      lifecycle(deal, 'entered_board', '2026-08-02', { stageId: 'new' }),
      lifecycle(deal, 'qualified', '2026-08-03', { stageId: 'q' }),
      lifecycle(deal, 'won', '2026-08-04', { stageId: undefined }),
    ] });
    expect(result.usesCustomerPromotion).toBe(false);
    expect(result.wonDeals).toHaveLength(1);
    expect(result.entryFunnel.stages.some(item => item.milestone === 'customer')).toBe(false);
    expect(result.entryFunnel.stages.every(item => !item.populationLabel.includes('Cliente'))).toBe(true);
  });
});
