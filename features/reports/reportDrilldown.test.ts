import { describe, expect, it } from 'vitest';
import { calculatePerformance } from './performanceMetrics';
import { filterReportProducts, NO_PRODUCT, reportDrilldown, salesCycleDays } from './reportDrilldown';
import { august, board, lead, lifecycle, snapshot } from './performanceTestFixtures';

const q = lead('q');
const won = lead('won');
const undocumented = lead('undocumented');
const old = lead('old', { createdAt: '2026-07-01' });
const lostQ = lead('lost-q', { lossCategory: 'qualified', lossReason: 'Contato Repetido' });
const lostDQ = lead('lost-dq', { lossCategory: 'disqualified', lossReason: 'REPETIDO.' });
const lostQ2 = lead('lost-q2', { lossCategory: 'qualified', lossReason: 'lead repetido' });
const unknown = lead('unknown', { items: [] });
const deals = [q, won, undocumented, old, lostQ, lostDQ, lostQ2, unknown];
const events = [
  ...deals.map(deal => lifecycle(deal, 'entered_board', deal.createdAt)),
  ...[q, won].map(deal => lifecycle(deal, 'qualified', '2026-08-02', { stageId: 'q' })),
  ...[won, undocumented, old].map(deal => lifecycle(deal, 'won', '2026-08-03', { stageId: 'won', value: 240 })),
  ...[lostQ, lostDQ, lostQ2, unknown].map(deal => lifecycle(deal, 'lost', '2026-08-04', { stageId: 'lost' })),
];
const fixture = (mode: 'cohort' | 'period' = 'cohort') => ({ ...calculatePerformance(deals, [], board, august, '', undefined, snapshot, { mode, lifecycleEvents: events }), deals });

describe('detalhamento reconciliado com indicadores', () => {
  it('taxas usam os mesmos subconjuntos e ganhos sem data qualificada continuam na receita', () => {
    const metrics = fixture();
    const qualification = reportDrilldown(metrics, { kind: 'qualification' });
    expect(qualification.groups[0].deals.map(deal => deal.id)).toEqual(['q', 'won']);
    expect(qualification.groups[0].deals.every(deal => qualification.groups[1].deals.some(entry => entry.id === deal.id))).toBe(true);
    const closing = reportDrilldown(metrics, { kind: 'closing' });
    expect(closing.groups[0].deals.map(deal => deal.id)).toEqual(['won']);
    expect(closing.groups[1].deals).toEqual(qualification.groups[0].deals);
    expect(closing.formula).toContain('1 ganhos entre os qualificados ÷ 2');
    const revenue = reportDrilldown(metrics, { kind: 'revenue' });
    expect(revenue.groups[0].deals.map(deal => deal.id)).toEqual(['undocumented', 'won']);
    expect(revenue.groups[0].deals.reduce((sum, deal) => sum + deal.value, 0)).toBe(metrics.wonRevenue);
  });
  it('fluxo apresenta volumes, preserva ganhos antigos e não exibe fórmula de taxa', () => {
    const metrics = fixture('period');
    const closing = reportDrilldown(metrics, { kind: 'closing' });
    expect(closing.formula).toBeUndefined();
    expect(closing.groups).toHaveLength(1);
    expect(closing.groups[0].deals.map(deal => deal.id)).toEqual(['old', 'undocumented', 'won']);
    expect(closing.contextDescription).toContain('própria data');
  });
  it('entradas e reaberturas do fluxo abrem os mesmos IDs contados', () => {
    const history = [...events, lifecycle(won, 'reopened', '2026-08-06'), lifecycle(won, 'reopened', '2026-08-08')];
    const metrics = { ...calculatePerformance(deals, [], board, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents: history }), deals };
    expect(reportDrilldown(metrics, { kind: 'entries' }).groups[0].deals).toEqual(metrics.entries);
    expect(reportDrilldown(metrics, { kind: 'reopened' }).groups[0].deals).toEqual(metrics.reopenedDeals);
    expect(metrics.reopenedDeals.map(deal => deal.id)).toEqual(['won']);
  });
  it('motivo normalizado mantém texto original e respeita categoria', () => {
    const grouped = reportDrilldown(fixture(), { kind: 'loss', category: 'qualified', reasonKey: 'duplicate_contact' });
    expect(grouped.groups[0].deals.map(deal => deal.id)).toEqual(['lost-q', 'lost-q2']);
    expect(grouped.groups[0].deals.map(deal => deal.lossReason)).toEqual(['Contato Repetido', 'lead repetido']);
    expect(reportDrilldown(fixture(), { kind: 'loss', category: 'disqualified', reason: 'Contato repetido' }).groups[0].deals.map(deal => deal.id)).toEqual(['lost-dq']);
    expect(reportDrilldown(fixture(), { kind: 'loss', category: 'unknown' }).groups[0].deals.map(deal => deal.id)).toEqual(['unknown']);
  });
  it('título de perdas só contém motivo quando há filtro de motivo', () => {
    const metrics = fixture();
    expect(reportDrilldown(metrics, { kind: 'loss' }).title).toBe('Perdas no Período');
    expect(reportDrilldown(metrics, { kind: 'loss', category: 'qualified' }).title).toBe('Perdas qualificadas');
    expect(reportDrilldown(metrics, { kind: 'loss', category: 'qualified', reasonKey: 'duplicate_contact' }).title).toBe('Perdas qualificadas · Contato repetido');
  });
  it('produto filtra negócio inteiro uma vez; sem produto é explícito', () => {
    expect(filterReportProducts(deals, NO_PRODUCT).map(deal => deal.id)).toEqual(['unknown']);
    expect(filterReportProducts(deals, 'missing')).toEqual([]);
    const multi = lead('multi', { items: [...won.items, { ...won.items[0], id: 'item2', productId: 'p2' }] });
    expect(filterReportProducts([multi], 'p1')).toEqual([multi]);
  });
  it('ciclo e vendedor usam os mesmos ganhos do detalhe', () => {
    const metrics = fixture();
    const detail = reportDrilldown(metrics, { kind: 'cycle' });
    expect(detail.groups[0].deals.map(deal => salesCycleDays(deal))).toEqual([2, 2]);
    expect(reportDrilldown(metrics, { kind: 'owner', ownerId: 'ana', ownerName: 'Ana' }).groups[0].deals).toEqual(metrics.wonDeals);
    expect(salesCycleDays(lead('bad', { closedAt: 'bad' }))).toBeNull();
  });
});
