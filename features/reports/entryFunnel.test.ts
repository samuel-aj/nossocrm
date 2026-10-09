import { describe, expect, it } from 'vitest';
import type { Deal } from '@/types';
import { calculatePerformance, type LifecycleEvent, type StageEvent } from './performanceMetrics';
import { august, board, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';

const period = (deals: Deal[], visits: StageEvent[], ledger: LifecycleEvent[], ownerId = '', productId = '', cutoff = snapshot) =>
  calculatePerformance(deals, visits, board, august, ownerId, undefined, cutoff, { mode: 'period', lifecycleEvents: ledger, productId });
const counts = (result: ReturnType<typeof period>) => result.entryFunnel.stages.map(stage => stage.count);

describe('progressão acumulada da base de entradas', () => {
  it('usa a mesma base em todas as colunas, sem converter saltos em visitas, qualificações ou ganhos novos', () => {
    const a = lead('a');
    const b = lead('b');
    const old = lead('old', { createdAt: '2026-07-01T00:00:00Z' });
    const result = period([a, b, old], [
      movement(a.id, 'proposal', '2026-08-05T12:00:00Z', 'new'),
      movement(b.id, 'won', '2026-08-06T12:00:00Z', 'q'),
      movement(old.id, 'q', '2026-08-07T12:00:00Z', 'new'),
    ], [
      lifecycle(a, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'new' }),
      lifecycle(b, 'entered_board', '2026-08-03T12:00:00Z', { stageId: 'q' }),
    ]);
    expect(result.entries.map(deal => deal.id)).toEqual(['a', 'b']);
    expect(result.entryFunnel.baseCount).toBe(2);
    expect(counts(result)).toEqual([2, 2, 2, 1, 1]);
    expect(result.stageData.map(stage => stage.count)).toEqual([1, 2, 1, 0, 1]);
    expect(result.qualifiedCount).toBe(2); // Existing event results also include the older lead.
    expect(result.wonDeals).toEqual([]); // Custom protocol is not a CUSTOMER promotion.
    expect(result.entryFunnel.unknownStageCount).toBe(0);
    expect(result.entryFunnel.stages[1].evidenceByDeal.get('a')).toEqual({
      stageName: 'Contrato', date: '2026-08-05T12:00:00Z', observedAtStage: false,
    });
    expect(result.entryFunnel.stages[1].evidenceByDeal.get('b')).toEqual({
      stageName: 'Proposta enviada', date: '2026-08-03T12:00:00Z', observedAtStage: true,
    });
    expect(result.entryFunnel.stages[3].evidenceByDeal.get('b')?.observedAtStage).toBe(false);
    for (const stage of result.entryFunnel.stages) {
      expect(stage.count).toBe(stage.deals.length);
      expect(stage.evidenceByDeal.size).toBe(stage.count);
      expect(stage.deals.every(deal => result.entries.includes(deal))).toBe(true);
      expect(stage.conversionRate).toBeNull();
      expect(stage.comparisonBase).toBe('');
      expect(stage.countingMethod).toBe('reached_or_beyond');
    }
  });

  it('ancora na primeira entrada selecionada e mantém responsável/produto da base ao medir avanços posteriores', () => {
    const deal = lead('a', { ownerId: 'bob', items: [{ id: 'p2', productId: 'p2', name: 'Produto 2', price: 100, quantity: 1 }] });
    const entryItems = lead('template').items;
    const result = period([deal], [], [
      lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'new', items: entryItems }), // Owner outside filter.
      lifecycle(deal, 'stage_changed', '2026-08-05T12:00:00Z', { stageId: 'won' }), // Before the selected entry.
      lifecycle(deal, 'entered_board', '2026-08-10T12:00:00Z', { stageId: 'q', ownerId: 'ana', items: entryItems }),
      lifecycle(deal, 'stage_changed', '2026-08-12T12:00:00Z', { stageId: 'proposal' }), // New owner/products cannot remove this progress.
      lifecycle(deal, 'entered_board', '2026-08-15T12:00:00Z', { stageId: 'new', ownerId: 'ana', items: entryItems }),
    ], 'ana', 'p1');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].updatedAt).toBe('2026-08-15T12:00:00Z'); // Preserve the existing entry snapshot contract.
    expect(counts(result)).toEqual([1, 1, 1, 0, 0]);
    expect(result.entryFunnel.stages[1].evidenceByDeal.get('a')?.date).toBe('2026-08-10T12:00:00Z');
    expect(result.entryFunnel.stages[2].evidenceByDeal.get('a')?.date).toBe('2026-08-12T12:00:00Z');
    expect(result.stageData[2].count).toBe(0); // Actual arrivals retain their separate event filters.
  });

  it('não inclui quem só satisfaz os filtros na chegada posterior', () => {
    const deal = lead('a');
    const result = period([deal], [], [
      lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z', { ownerId: 'bob', stageId: 'new' }),
      lifecycle(deal, 'stage_changed', '2026-08-05T12:00:00Z', { ownerId: 'ana', stageId: 'proposal' }),
    ], 'ana', 'p1');
    expect(result.stageData[2].count).toBe(1);
    expect(result.entryFunnel.baseCount).toBe(0);
    expect(counts(result)).toEqual([0, 0, 0, 0, 0]);
  });

  it('preserva o máximo após saída, reentrada, reabertura, retrocesso e perda, sem duplicar IDs', () => {
    const deal = lead('a');
    const result = period([deal], [
      movement(deal.id, 'won', '2026-08-05T12:00:00Z', 'new'),
      movement(deal.id, 'q', '2026-08-12T12:00:00Z', 'new'),
    ], [
      lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'new' }),
      lifecycle(deal, 'stage_changed', '2026-08-05T12:00:00Z', { stageId: 'won' }),
      lifecycle(deal, 'left_board', '2026-08-06T12:00:00Z'),
      lifecycle(deal, 'entered_board', '2026-08-10T12:00:00Z', { stageId: 'new' }),
      lifecycle(deal, 'reopened', '2026-08-11T12:00:00Z', { stageId: 'new' }),
      lifecycle(deal, 'lost', '2026-08-14T12:00:00Z', { stageId: 'lost' }),
      lifecycle(deal, 'stage_changed', '2026-08-14T12:00:00Z', { stageId: 'lost', isLost: true }),
    ]);
    expect(counts(result)).toEqual([1, 1, 1, 1, 1]);
    expect(result.entryFunnel.baseCount).toBe(1);
    expect(result.reopenedDeals).toHaveLength(1);
    expect(result.lostDeals).toHaveLength(1);
    expect(result.entryFunnel.stages[2].evidenceByDeal.get('a')).toEqual({
      stageName: 'Protocolado', date: '2026-08-05T12:00:00Z', observedAtStage: false,
    });
    expect(result.entryFunnel.stages[1].evidenceByDeal.get('a')?.observedAtStage).toBe(true);
  });

  it('não inventa progresso usando situação atual, etapa removida, origem da movimentação ou perda terminal', () => {
    const missing = lead('missing', { status: 'won' });
    const removed = lead('removed', { status: 'proposal' });
    const lost = lead('lost', { status: 'lost', isLost: true });
    const result = period([missing, removed, lost], [
      movement(missing.id, 'lost', '2026-08-05T12:00:00Z', 'proposal'),
    ], [
      lifecycle(missing, 'entered_board', '2026-08-02T12:00:00Z', { stageId: undefined }),
      lifecycle(removed, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'deleted-stage' }),
      lifecycle(lost, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'lost' }),
    ]);
    expect(result.entryFunnel.baseCount).toBe(3);
    expect(result.entryFunnel.unknownStageCount).toBe(3);
    expect(counts(result)).toEqual([0, 0, 0, 0, 0]);
    expect(result.entryFunnel.stages.map(stage => stage.stageId)).not.toContain('lost');
  });

  it('respeita o funil e o corte de apuração sem importar movimentos de outro funil ou posteriores', () => {
    const deal = lead('a');
    const result = period([deal], [
      movement(deal.id, 'q', '2026-08-05T12:00:00Z', 'new'),
      { ...movement(deal.id, 'won', '2026-08-06T12:00:00Z', 'q'), boardId: 'other-board' },
      movement(deal.id, 'signed', '2026-08-11T12:00:00Z', 'q'),
    ], [
      lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z'),
      lifecycle(deal, 'stage_changed', '2026-08-08T12:00:00Z', { boardId: 'other-board', stageId: 'proposal' }),
    ], '', '', new Date('2026-08-10T12:00:00Z'));
    expect(counts(result)).toEqual([1, 1, 0, 0, 0]);
    expect(result.wonDeals).toHaveLength(0);
    expect(result.entryFunnel.stages[1].evidenceByDeal.get('a')?.date).toBe('2026-08-05T12:00:00Z');
    const monthEnd = period([deal], [movement(deal.id, 'won', '2026-09-01T00:00:00Z', 'new')], [
      lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z'),
    ]);
    expect(counts(monthEnd)).toEqual([1, 0, 0, 0, 0]);
  });

  it('preserva microssegundos na âncora mesmo quando Date.parse produz o mesmo milissegundo', () => {
    const deal = lead('a');
    const result = period([deal], [
      movement(deal.id, 'won', '2026-08-05T12:00:00.000100Z', 'new'),
      movement(deal.id, 'proposal', '2026-08-05T12:00:00.000300Z', 'q'),
    ], [lifecycle(deal, 'entered_board', '2026-08-05T12:00:00.000200Z', { stageId: 'q' })]);
    expect(counts(result)).toEqual([1, 1, 1, 0, 0]);
    expect(result.entryFunnel.stages[2].evidenceByDeal.get('a')?.date).toBe('2026-08-05T12:00:00.000300Z');
  });

  it('usa recorded_at do ledger para não ressuscitar uma chegada anterior à entrada na mesma transação', () => {
    const deal = lead('a');
    const date = '2026-08-05T12:00:00Z';
    const result = period([deal], [movement(deal.id, 'won', date, 'new')], [
      lifecycle(deal, 'stage_changed', date, { stageId: 'won', recordedAt: '2026-08-05T12:00:00.000100Z' }),
      lifecycle(deal, 'entered_board', date, { stageId: 'q', recordedAt: '2026-08-05T12:00:00.000200Z' }),
      lifecycle(deal, 'stage_changed', date, { id: 'later', stageId: 'proposal', recordedAt: '2026-08-05T12:00:00.000300Z' }),
    ]);
    expect(counts(result)).toEqual([1, 1, 1, 0, 0]);
    expect(result.entryFunnel.stages[3].deals).toEqual([]);
  });

  it('mantém a primeira data de ganho e os cards quando o protocolo ocorre depois da assinatura', () => {
    const deal = lead('a', { status: 'won', isWon: true, closedAt: '2026-08-05T12:00:00Z' });
    const result = period([deal], [], [
      lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'new' }),
      lifecycle(deal, 'won', '2026-08-05T12:00:00Z', { stageId: 'signed' }),
      lifecycle(deal, 'stage_changed', '2026-08-05T12:00:00Z', { stageId: 'signed', isWon: true }),
      lifecycle(deal, 'stage_changed', '2026-08-07T12:00:00Z', { stageId: 'won', isWon: true }),
    ]);
    expect(result.wonDeals).toHaveLength(1);
    expect(result.wonDeals[0].closedAt).toBe('2026-08-05T12:00:00Z');
    expect(result.wonRevenue).toBe(100);
    expect(counts(result)).toEqual([1, 1, 1, 1, 1]);
    expect(result.entryFunnel.stages[3].evidenceByDeal.get('a')).toEqual({
      stageName: 'Assinado', date: '2026-08-05T12:00:00Z', observedAtStage: true,
    });
    expect(result.entryFunnel.stages[4].evidenceByDeal.get('a')?.date).toBe('2026-08-07T12:00:00Z');
  });

  it('segue a ordem configurada sem classificar etapas opcionais pelo nome', () => {
    const deal = lead('a');
    const reordered = { ...board, stages: [board.stages[0], board.stages[2], board.stages[1], ...board.stages.slice(3)] };
    const result = calculatePerformance([deal], [], reordered, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents: [
      lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'q' }),
    ] });
    expect(result.entryFunnel.stages.map(stage => stage.stageId)).toEqual(['new', 'proposal', 'q', 'signed', 'won']);
    expect(counts(result)).toEqual([1, 1, 1, 0, 0]);
  });

  it('deixa o novo funil vazio nos outros modos e não altera seus gráficos', () => {
    const deal = lead('a');
    for (const mode of ['cohort', 'current'] as const) {
      const result = calculatePerformance([deal], [], board, august, '', undefined, snapshot, { mode, lifecycleEvents: [
        lifecycle(deal, 'entered_board', '2026-08-02T12:00:00Z', { stageId: 'new' }),
      ] });
      expect(result.entryFunnel).toEqual({ stages: [], baseCount: 0, unknownStageCount: 0 });
      expect(result.stageData[0].count).toBe(1);
    }
  });
});
