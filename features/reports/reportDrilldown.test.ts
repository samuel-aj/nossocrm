import { describe, expect, it } from 'vitest';
import { calculatePerformance } from './performanceMetrics';
import { filterReportProducts, NO_PRODUCT, reportDrilldown, salesCycleDays } from './reportDrilldown';
import { august, board, lead, lifecycle, snapshot } from './performanceTestFixtures';
import { monthlyPresentationFixture } from './monthlyPresentationTestFixture';

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
const fixture = (mode: 'cohort' | 'period' | 'conversion' = 'cohort') => ({ ...calculatePerformance(deals, [], board, august, '', undefined, snapshot, { mode, lifecycleEvents: events }), deals });

describe('detalhamento reconciliado com indicadores', () => {
  it('mensal mantém sete contratos, mas a base e as taxas não incorporam os três ganhos de fora', () => {
    const metrics = monthlyPresentationFixture();
    const qualification = reportDrilldown(metrics, { kind: 'qualification' });
    const closing = reportDrilldown(metrics, { kind: 'closing' });
    const closures = reportDrilldown(metrics, { kind: 'closures' });
    const total = reportDrilldown(metrics, { kind: 'total-conversion' });
    const ids = (rows: typeof metrics.deals) => rows.map(row => row.id).sort();
    expect(metrics.workedDeals).toHaveLength(10);
    expect(metrics.entries).toHaveLength(10);
    expect(metrics.qualifiedDeals).toHaveLength(6);
    expect(metrics.wonDeals).toHaveLength(7);
    expect(metrics.cohortWonDeals).toHaveLength(4);
    expect(qualification.groups[1].deals).toBe(metrics.entries);
    expect(qualification.formula).toBe('6 qualificados ÷ 10 entradas no funil');
    expect(closing.groups[0].deals).toBe(metrics.cohortWonDeals);
    expect(closing.groups.find(group => group.id === 'all-won')!.deals).toBe(metrics.wonDeals);
    expect(closing.groups.find(group => group.id === 'unqualified-won')!.deals).toHaveLength(0);
    expect(closing.groups.find(group => group.id === 'outside-entry-won')!.deals.map(row => row.id)).toEqual(['winner-5', 'winner-6', 'winner-7']);
    expect(closing.formula).toContain('4 ganhos entre os qualificados ÷ 6 qualificados');
    expect(closing.formula).toContain('Total do período: 7 ganhos, incluindo 3 fora da base');
    expect(closures.groups[0].deals).toBe(metrics.wonDeals);
    expect(total.groups[0].deals).toBe(metrics.entryWonDeals);
    expect(total.groups[1].deals).toBe(metrics.entries);
    expect(total.formula).toBe('4 ganhos da base de entradas ÷ 10 entradas no funil');
    expect(ids(closures.groups[0].deals)).toEqual(ids(metrics.entryFunnel.stages.find(stage => stage.milestone === 'customer')!.deals));
    expect(ids(qualification.groups[0].deals)).toEqual(ids(metrics.entryFunnel.stages.find(stage => stage.milestone === 'qualification')!.deals));
    expect(reportDrilldown(metrics, { kind: 'revenue' }).groups[0].deals).toBe(metrics.wonDeals);
    expect(reportDrilldown(metrics, { kind: 'entries' }).groups[0].deals).toBe(metrics.entries);
    expect(reportDrilldown(metrics, { kind: 'worked' }).groups[0].deals).toBe(metrics.entries);
    expect(closures.dateBasisLabel).toBe('Data do ganho registrado');
    expect(closures.contextDescription).toContain('não comprova a data da assinatura');
    expect(closures.contextDescription).toContain('selecionados pelos dados da entrada');
    expect(closures.contextDescription).toContain('responsável, produtos e valores atuais');
    expect(closures.contextDescription).not.toContain('com atividade');
  });

  it('mensal explica que qualificação posterior ao ganho não entra na taxa, sem retirar o contrato', () => {
    const deal = lead('later-q', { status: 'won', isWon: true, closedAt: '2026-08-10T12:00:00Z' });
    const metrics = { ...calculatePerformance([deal], [], board, august, '', undefined, snapshot, {
      mode: 'monthly', lifecycleEvents: [lifecycle(deal, 'entered_board', deal.createdAt, { stageId: 'new', isWon: false }), lifecycle(deal, 'qualified', '2026-08-12T12:00:00Z', { stageId: 'q' })],
    }), deals: [deal] };
    const detail = reportDrilldown(metrics, { kind: 'closing' });
    expect(detail.groups[0].deals).toHaveLength(0);
    expect(detail.groups[1].deals.map(row => row.id)).toEqual([deal.id]);
    expect(detail.groups.find(group => group.id === 'all-won')!.deals.map(row => row.id)).toEqual([deal.id]);
    const noPriorQualification = detail.groups.find(group => group.id === 'unqualified-won')!;
    expect(noPriorQualification.deals.map(row => row.id)).toEqual([deal.id]);
    expect(noPriorQualification.description).toContain('uma qualificação posterior não entra nesse numerador');
    expect(detail.formula).toContain('sem qualificação prévia comprovada');
  });

  it('conversão reconcilia entradas, marcos, numeradores e denominadores pelos mesmos IDs', () => {
    const qualified = lead('entry-qualified');
    const converted = lead('entry-converted');
    const noQualification = lead('entry-no-qualification');
    const open = lead('entry-open');
    const earlier = lead('earlier-entry', { createdAt: '2026-07-01' });
    const conversionDeals = [qualified, converted, noQualification, open, earlier];
    const history = [
      ...[qualified, converted, noQualification, open].map(deal => lifecycle(deal, 'entered_board', '2026-08-02')),
      lifecycle(earlier, 'entered_board', '2026-07-01'),
      ...[qualified, converted, earlier].map(deal => lifecycle(deal, 'qualified', '2026-08-03', { stageId: 'q' })),
      ...[converted, noQualification, earlier].map(deal => lifecycle(deal, 'won', '2026-08-05', { stageId: 'signed', value: 240 })),
      lifecycle(converted, 'stage_changed', '2026-08-06', { stageId: 'won', isWon: true }),
    ];
    const metrics = { ...calculatePerformance(conversionDeals, [], board, august, '', undefined, snapshot,
      { mode: 'conversion', lifecycleEvents: history }), deals: conversionDeals };
    const ids = (rows: typeof conversionDeals) => rows.map(deal => deal.id).sort();
    const qualification = reportDrilldown(metrics, { kind: 'qualification' });
    const closing = reportDrilldown(metrics, { kind: 'closing' });
    const total = reportDrilldown(metrics, { kind: 'total-conversion' });
    expect(ids(qualification.groups[0].deals)).toEqual(['entry-converted', 'entry-qualified']);
    expect(qualification.groups[0].deals).toBe(metrics.qualifiedDeals);
    expect(qualification.groups[1].deals).toBe(metrics.entries);
    expect(ids(qualification.groups[0].deals)).toEqual(ids(metrics.entryFunnel.stages.find(stage => stage.milestone === 'qualification')!.deals));
    expect(ids(closing.groups[0].deals)).toEqual(['entry-converted']);
    expect(ids(closing.groups[0].deals)).toEqual(ids(metrics.entryFunnel.stages.find(stage => stage.milestone === 'customer')!.deals));
    expect(closing.groups[1].deals).toBe(metrics.qualifiedDeals);
    expect(total.groups[0].deals).toBe(metrics.cohortWonDeals);
    expect(total.groups[1].deals).toBe(metrics.entries);
    expect(qualification.formula).toBe('2 qualificados ÷ 4 entradas no funil');
    expect(closing.formula).toBe('1 ganhos entre os qualificados ÷ 2 qualificados da base de entradas');
    expect(total.formula).toBe('1 ganhos entre os qualificados ÷ 4 entradas no funil');
    expect(qualification.contextDescription).toContain('entrada registrada no funil');
    expect(qualification.contextDescription).not.toMatch(/criados no período|própria data|Não são taxas/);
    expect(reportDrilldown(metrics, { kind: 'revenue' }).groups[0].deals).toBe(metrics.wonDeals);
    const diagnostics = reportDrilldown(metrics, { kind: 'diagnostics' });
    expect(diagnostics.groups[0].deals).toBe(metrics.diagnosticsDeals);
    expect(diagnostics.diagnosticReasonsByDeal).toBe(metrics.diagnosticReasonsByDeal);
    expect(diagnostics.groups[0].deals.some(deal => deal.id === noQualification.id)).toBe(true);
    expect(diagnostics.diagnosticReasonsByDeal?.get(noQualification.id)?.length).toBeGreaterThan(0);
    expect(metrics.unqualifiedWonDeals.map(deal => deal.id)).toContain(noQualification.id);
  });

  it('fechamentos revela o denominador da conversão total e preserva ganhos e perdas qualificadas', () => {
    const metrics = fixture('conversion');
    const detail = reportDrilldown(metrics, { kind: 'closures' });
    expect(detail.groups.map(group => group.id)).toEqual(['won', 'qualified-lost', 'entries']);
    expect(detail.groups[0].deals).toBe(metrics.wonDeals);
    expect(detail.groups[0].deals.map(deal => deal.id)).toEqual(['won']);
    expect(detail.groups[1].deals.map(deal => deal.id)).toEqual(['lost-q', 'lost-q2']);
    expect(detail.groups[2].deals).toBe(metrics.entries);
    expect(detail.groups[2].deals).toHaveLength(7);
    expect(detail.groups[2].deals.some(deal => deal.id === 'old')).toBe(false);
    expect(detail.formula).toBe('Conversão total: 1 ganhos entre os qualificados ÷ 7 entradas no funil');
  });
  it.each(['cohort', 'period'] as const)('fechamentos preserva o detalhe anterior no modo %s', mode => {
    const detail = reportDrilldown(fixture(mode), { kind: 'closures' });
    expect(detail.groups.map(group => group.id)).toEqual(['won', 'qualified-lost']);
    expect(detail.formula).toBeUndefined();
  });

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
