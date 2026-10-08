import { describe, expect, it } from 'vitest';
import { calculatePerformance } from './performanceMetrics';
import { dealAtEvent, lifecycleEventFromRow, type DbLifecycleEvent } from './performanceHistory';
import { groupLeadSources, leadSourceSlices, UNKNOWN_LEAD_SOURCE_KEY } from './leadSourceReport';
import { reportDrilldown } from './reportDrilldown';
import { august, board, lead, lifecycle, movement, snapshot } from './performanceTestFixtures';

describe('origem dos leads na mesma base do relatório', () => {
  it('inclui origem vazia no denominador, respeita null explícito e nunca infere por UTM', () => {
    const deals = [lead('native', { leadSource: 'Meta Ads', customFields: { origem: 'Google Ads' } }),
      lead('legacy', { customFields: { origem: 'Google Ads' } }),
      lead('cleared', { leadSource: null, customFields: { origem: 'Meta Ads', utm_source: 'google', utm_medium: 'cpc' } }),
      lead('unknown', { customFields: { utm_source: 'facebook', utm_medium: 'cpc' } })];
    const groups = groupLeadSources([...deals, deals[0]]);
    expect(groups.map(group => [group.label, group.count, group.percentage])).toEqual([
      ['Não informado', 2, 50], ['Google Ads', 1, 25], ['Meta Ads', 1, 25],
    ]);
    expect(groups.flatMap(group => group.deals)).toHaveLength(4);
  });
  it('preserva a origem da entrada após edição atual e seleciona responsável histórico/produto atual na coorte', () => {
    const original = lead('edited', { leadSource: 'Meta Ads' });
    const current = { ...original, leadSource: 'Google Ads', ownerId: 'bia' };
    const entry = lifecycle(original, 'entered_board', original.createdAt, { items: [] });
    const metrics = calculatePerformance([current], [], board, august, 'ana', undefined, snapshot, { lifecycleEvents: [entry], productId: 'p1' });
    expect(metrics.leadSourceTotal).toBe(1);
    expect(metrics.leadSourceGroups[0]).toMatchObject({ label: 'Meta Ads', count: 1, percentage: 100 });
    expect(metrics.leadSourceGroups[0].deals.map(deal => deal.id)).toEqual(metrics.entries.map(deal => deal.id));
    expect(metrics.coverage.legacyLeadSourceSnapshotCount).toBe(0);
    expect(calculatePerformance([current], [], board, august, 'bia', undefined, snapshot, { lifecycleEvents: [entry] }).leadSourceTotal).toBe(0);
    expect(calculatePerformance([current], [], board, august, '', undefined, snapshot, { lifecycleEvents: [entry], productId: 'p2' }).leadSourceTotal).toBe(0);
  });
  it('preserva snapshot null mesmo com origem nativa e legado preenchidos depois', () => {
    const current = lead('later', { leadSource: 'Meta Ads', customFields: { origem: 'Google Ads' } });
    const entry = lifecycle(current, 'entered_board', current.createdAt, { leadSource: null });
    const metrics = calculatePerformance([current], [], board, august, '', undefined, snapshot, { lifecycleEvents: [entry] });
    expect(dealAtEvent(current, entry).leadSource).toBeNull();
    expect(metrics.leadSourceGroups[0]).toMatchObject({ key: UNKNOWN_LEAD_SOURCE_KEY, count: 1, percentage: 100 });
    expect(metrics.coverage.legacyLeadSourceSnapshotCount).toBe(0);
  });
  it('no período conta entradas distintas com filtros do evento, incluindo antigos e transferidos', () => {
    const old = lead('old', { createdAt: '2026-07-01', boardId: 'other', ownerId: 'bia', items: [], leadSource: 'Atual' });
    const noEntry = lead('only-win', { createdAt: '2026-07-01', leadSource: 'Indicação' });
    const entry = lifecycle(old, 'entered_board', '2026-08-02', { ownerId: 'ana', leadSource: 'Presencial', items: lead('item').items });
    const events = [entry, { ...entry, id: 'reentry', date: '2026-08-20' }, lifecycle(noEntry, 'won', '2026-08-03')];
    const metrics = calculatePerformance([old, noEntry], [], board, august, 'ana', undefined, snapshot, { mode: 'period', lifecycleEvents: events, productId: 'p1' });
    expect(metrics.leadSourceTotal).toBe(1);
    expect(metrics.leadSourceGroups[0]).toMatchObject({ label: 'Presencial', count: 1 });
    expect(metrics.entries.map(deal => deal.id)).toEqual(['old']);
    expect(metrics.wonDeals.map(deal => deal.id)).toContain('only-win');
  });
  it('na carteira usa origem atual e exclui ganhos/perdas sem filtrar por data antiga', () => {
    const open = lead('open', { leadSource: 'Google Ads', createdAt: '2026-07-01' });
    const deals = [open, lead('won', { isWon: true, leadSource: 'Meta Ads' }), lead('lost', { isLost: true }),
      lead('client', { status: 'signed' }), lead('other-owner', { ownerId: 'bia' })];
    const metrics = calculatePerformance(deals, [], board, august, 'ana', undefined, snapshot, { mode: 'current', productId: 'p1',
      lifecycleEvents: [lifecycle(open, 'entered_board', open.createdAt, { leadSource: 'Meta Ads' })] });
    expect(metrics.leadSourceTotal).toBe(1);
    expect(metrics.leadSourceGroups[0]).toMatchObject({ label: 'Google Ads', count: 1 });
    expect(metrics.entries).toEqual(metrics.currentDeals);
    expect(metrics.coverage.legacyLeadSourceSnapshotCount).toBe(0);
  });
  it('contabiliza somente origens históricas aproximadas da base selecionada', () => {
    const legacy = lead('legacy', { customFields: { origem: 'Indicação' } });
    const exact = lead('exact', { leadSource: 'Meta Ads' });
    const excluded = lead('outside', { ownerId: 'bia', leadSource: 'Google Ads' });
    const events = [lifecycle(exact, 'entered_board', exact.createdAt), lifecycle(excluded, 'entered_board', excluded.createdAt, { leadSourceSnapshotSource: 'current' })];
    const metrics = calculatePerformance([legacy, exact, excluded], [movement(legacy.id, 'new', legacy.createdAt)], board, august, 'ana', undefined, snapshot, { lifecycleEvents: events });
    expect(metrics.leadSourceTotal).toBe(2);
    expect(metrics.coverage.legacyLeadSourceSnapshotCount).toBe(1);
    expect(metrics.leadSourceGroups.map(group => group.label)).toEqual(['Indicação', 'Meta Ads']);
  });
  it('campos de origem ausentes no ledger legado ficam desconhecidos e marcados como aproximação', () => {
    const current = lead('omitted', { leadSource: 'Meta Ads' });
    const mapped = lifecycleEventFromRow({ id: 'e', deal_id: current.id, board_id: board.id, event_type: 'entered_board', occurred_at: current.createdAt,
      source: 'history', snapshot_source: 'transition', lead_source_snapshot_source: 'transition', stage_id: 'new', owner_id: 'ana', value: 100, title: current.title,
      deal_created_at: current.createdAt, items: [], loss_category: null, loss_reason: null, is_won: false, is_lost: false } satisfies DbLifecycleEvent);
    const metrics = calculatePerformance([current], [], board, august, '', undefined, snapshot, { lifecycleEvents: [mapped] });
    expect(metrics.leadSourceGroups[0].label).toBe('Não informado');
    expect(metrics.coverage.legacyLeadSourceSnapshotCount).toBe(1);
  });
  it('mantém 0/1/muitas origens com cores estáveis, Outros nativo distinto e detalhes completos', () => {
    expect(groupLeadSources([])).toEqual([]);
    expect(leadSourceSlices([])).toEqual([]);
    const deals = Array.from({ length: 10 }, (_, index) => lead(String(index), { leadSource: index === 0 ? null : index === 1 ? 'Outros' : `Campanha ${index}` }));
    const groups = groupLeadSources(deals);
    const slices = leadSourceSlices(groups);
    expect(slices).toHaveLength(6);
    expect(slices.some(group => group.key === UNKNOWN_LEAD_SOURCE_KEY)).toBe(true);
    expect(slices.reduce((sum, group) => sum + group.count, 0)).toBe(10);
    expect(new Set(slices.flatMap(group => group.sourceKeys)).size).toBe(10);
    const single = groupLeadSources([deals[4]]);
    expect(single[0].percentage).toBe(100);
    expect(single[0].color).toBe(groups.find(group => group.key === single[0].key)!.color);
    const metrics = calculatePerformance(deals, [], board, august, '', undefined, snapshot, { mode: 'current' });
    const overflow = slices.find(group => group.key === 'overflow')!;
    const detail = reportDrilldown({ ...metrics, deals }, { kind: 'source', keys: overflow.sourceKeys });
    expect(detail.showSource).toBe(true);
    expect(detail.groups[0].deals.map(deal => deal.id).sort()).toEqual(overflow.deals.map(deal => deal.id).sort());
    expect(detail.groups.slice(1).map(group => group.id)).toEqual(overflow.sourceKeys);
    expect(reportDrilldown({ ...metrics, deals }, { kind: 'source' }).groups[0].deals).toHaveLength(10);
  });
});
