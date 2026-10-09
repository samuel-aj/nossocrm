import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Board, Deal } from '@/types';
import { calculatePerformance } from '../performanceMetrics';
import { generateReportPDF } from './generateReportPDF';
import { august, board as fixtureBoard, lead, lifecycle, movement, snapshot } from '../performanceTestFixtures';
import { reportDrilldown } from '../reportDrilldown';

const output = vi.hoisted(() => ({ table: vi.fn(), text: vi.fn(), save: vi.fn() }));
vi.mock('jspdf', () => ({ jsPDF: class {
  setFontSize() {} text = output.text; save = output.save;
  splitTextToSize(value: string) { return value.split('\n'); }
} }));
vi.mock('jspdf-autotable', () => ({ default: (...args: unknown[]) => output.table(...args) }));
const board = { id: 'b', stages: [{ id: 'q', label: 'Proposta enviada', linkedLifecycleStage: 'MQL' }] } as Board;
const range = { start: new Date('2026-08-01'), end: new Date('2026-08-31') };
const context = { boardName: 'DBA', period: 'Agosto', range: '01/08 a 31/08', owner: 'Todos', generatedBy: 'Teste' };
const tables = () => output.table.mock.calls.map(call => call[1]);
beforeEach(() => vi.clearAllMocks());
describe('PDF Performance', () => {
  it('exporta as três taxas e os mesmos conjuntos dos cartões, marcos e detalhes da base de entradas', () => {
    const qualified = lead('entry-qualified');
    const converted = lead('entry-converted');
    const noQualification = lead('entry-no-qualification');
    const open = lead('entry-open', { leadSource: null });
    const earlier = lead('earlier-entry', { createdAt: '2026-07-01' });
    const deals = [qualified, converted, noQualification, open, earlier];
    const history = [
      ...[qualified, converted, noQualification, open].map(deal => lifecycle(deal, 'entered_board', '2026-08-02')),
      lifecycle(earlier, 'entered_board', '2026-07-01'),
      ...[qualified, converted, earlier].map(deal => lifecycle(deal, 'qualified', '2026-08-03', { stageId: 'q' })),
      ...[converted, noQualification, earlier].map(deal => lifecycle(deal, 'won', '2026-08-05', { stageId: 'signed', value: 240 })),
      lifecycle(converted, 'stage_changed', '2026-08-06', { stageId: 'won', isWon: true }),
    ];
    const metrics = calculatePerformance(deals, [], fixtureBoard, august, '', undefined, snapshot, { mode: 'conversion', lifecycleEvents: history });
    generateReportPDF(metrics, { ...context, mode: 'conversion' });
    const indicators = tables()[0].body;
    expect(indicators).toContainEqual(['Taxa de qualificação', '50,0%', '2 qualificados / 4 entradas no funil']);
    expect(indicators).toContainEqual(['Taxa de fechamento', '50,0%', '1 ganhos entre os qualificados / 2 qualificados da base de entradas']);
    expect(indicators).toContainEqual(['Conversão total', '25,0%', '1 ganhos entre os qualificados / 4 entradas no funil']);
    expect(indicators.find((row: string[]) => row[0] === 'Entradas')[1]).toBe('4');
    expect(indicators.find((row: string[]) => row[0] === 'Ganhos')[1]).toBe('1');
    expect(indicators.find((row: string[]) => row[0] === 'Faturamento fechado')[1]).toMatch(/240,00/);
    const progression = tables()[1];
    expect(progression.head[0][1]).toBe('Leads da base de entradas');
    const qualifiedStage = metrics.entryFunnel.stages.find(stage => stage.milestone === 'qualification')!;
    const customerStage = metrics.entryFunnel.stages.find(stage => stage.milestone === 'customer')!;
    const qualification = reportDrilldown({ ...metrics, deals }, { kind: 'qualification' });
    const closing = reportDrilldown({ ...metrics, deals }, { kind: 'closing' });
    const ids = (rows: Deal[]) => rows.map(deal => deal.id).sort();
    expect(ids(qualification.groups[0].deals)).toEqual(ids(qualifiedStage.deals));
    expect(ids(closing.groups[0].deals)).toEqual(ids(customerStage.deals));
    expect(progression.body.find((row: unknown[]) => row[0] === qualifiedStage.name)[1]).toBe(qualification.groups[0].deals.length);
    expect(progression.body.find((row: unknown[]) => row[0] === customerStage.name)[1]).toBe(closing.groups[0].deals.length);
    expect(tables()[2].body.at(-1)).toEqual(['Total da base', 4, '100,0%']);
    const notes = JSON.stringify(tables().at(-1).body);
    expect(notes).toContain('Todos os indicadores usam a mesma base de entradas');
    expect(notes).toContain('Saltos não comprovam passagens intermediárias');
    expect(notes).toContain('protocolo, não substituem a prova de promoção a Cliente');
    expect(notes).toContain('1 ganhos não têm qualificação prévia válida');
    expect(notes).not.toMatch(/não são taxas de conversão|filtros usam o instante do acontecimento|produto é o associado atualmente/);
    expect(output.save).toHaveBeenCalledWith(expect.stringContaining('performance-conversion-'));
  });

  it('exporta denominadores vazios como traço na conversão', () => {
    const metrics = calculatePerformance([], [], fixtureBoard, august, '', undefined, snapshot, { mode: 'conversion' });
    generateReportPDF(metrics, context);
    expect(tables()[0].body.filter((row: string[]) => ['Taxa de qualificação', 'Taxa de fechamento', 'Conversão total'].includes(row[0])).map((row: string[]) => row[1])).toEqual(['—', '—', '—']);
  });

  it('exporta todas as origens da mesma base da pizza e lista, incluindo null e histórico reconstruído', () => {
    const deals = [lead('one', { leadSource: 'Meta Ads' }), lead('two', { leadSource: null }), lead('three', { leadSource: 'Google Ads' })];
    const events = deals.map(deal => lifecycle(deal, 'entered_board', deal.createdAt, { leadSourceSnapshotSource: deal.id === 'three' ? 'current' : 'transition' }));
    const data = calculatePerformance(deals, [], fixtureBoard, august, '', undefined, snapshot, { lifecycleEvents: events });
    const detail = reportDrilldown({ ...data, deals }, { kind: 'source' });
    generateReportPDF(data, context);
    const sourceTable = tables().find(table => table.head[0][0] === 'Origem do lead');
    expect(sourceTable.body).toEqual([['Google Ads', 1, '33,3%'], ['Meta Ads', 1, '33,3%'], ['Não informado', 1, '33,3%'], ['Total da base', 3, '100,0%']]);
    expect(detail.groups[0].deals).toHaveLength(sourceTable.body.at(-1)[1]);
    expect(JSON.stringify(tables())).toContain('1 lead tem origem histórica reconstruída ou indisponível');
    expect(JSON.stringify(tables())).toContain('Não informado faz parte do total');
  });
  it('explica denominadores da mesma coorte e limita a qualificação a datas comprovadas', () => {
    const metrics = calculatePerformance([], [], board, range);
    generateReportPDF(metrics, context);
    const rows = tables().flatMap(table => table.body);
    expect(rows).toContainEqual(['Taxa de qualificação', '—', '0 qualificados / 0 leads do mesmo grupo']);
    expect(rows).toContainEqual(['Taxa de fechamento', '—', '0 ganhos entre os qualificados / 0 qualificados do mesmo grupo; 0 ganhos sem qualificação prévia comprovada ficam fora da taxa']);
    expect(JSON.stringify(rows)).toContain('Estimativas não entram nas taxas');
    expect(JSON.stringify(rows)).not.toContain('Taxas acima de 100% são válidas');
    expect(JSON.stringify(rows)).toContain('Fechamento automático = promoção para Cliente');
    expect(JSON.stringify(rows)).toContain('não geram outro ganho nem alteram sua data');
  });
  it('não aplica a explicação de promoção comercial a um funil de clientes', () => {
    const metrics = calculatePerformance([], [], { ...board, linkedLifecycleStage: 'CUSTOMER' }, range);
    generateReportPDF(metrics, { ...context, customerPipeline: true });
    expect(JSON.stringify(tables())).not.toContain('Fechamento automático = promoção para Cliente');
  });
  it('exporta volumes do período sem taxas e agrupa grafias preservadas', () => {
    const metrics = calculatePerformance([], [], board, range, '', undefined, new Date(), { mode: 'period' });
    metrics.lostDeals = [{ lossCategory: 'disqualified', lossReason: 'Contato repetido' }, { lossCategory: 'disqualified', lossReason: 'REPETIDO.' }] as Deal[];
    generateReportPDF(metrics, context);
    const rows = tables().flatMap(table => table.body);
    expect(rows.some(row => row[0] === 'Taxa de fechamento')).toBe(false);
    expect(rows).toContainEqual(['Desqualificados', 'Contato repetido', 2, '100,0%']);
    expect(metrics.lostDeals[1].lossReason).toBe('REPETIDO.');
  });
  it('mantém a quantidade histórica mesmo sem MQL atualmente configurado', () => {
    const metrics = calculatePerformance([], [], { ...board, stages: [] }, range, '', undefined, new Date(), { mode: 'period' });
    metrics.qualifiedCount = 1;
    generateReportPDF(metrics, context);
    expect(tables()[0].body.find(row => row[0] === 'Qualificados')[1]).toBe('1');
  });
  it('exporta carteira atual sem aplicar o período nem indicadores históricos', () => {
    const metrics = calculatePerformance([], [], board, range, '', undefined, new Date(), { mode: 'current' });
    generateReportPDF(metrics, context);
    expect(tables()[0].body).toHaveLength(2);
    expect(JSON.stringify(output.text.mock.calls)).toContain('período não se aplica');
    expect(output.save).toHaveBeenCalledWith(expect.stringContaining('performance-current-'));
  });

  it('exporta a progressão acumulada dos mesmos entrantes, mantendo os resultados do período separados', () => {
    const entrant = lead('entry');
    const old = lead('old', { createdAt: '2026-07-01' });
    const lifecycleEvents = [lifecycle(entrant, 'entered_board', entrant.createdAt), lifecycle(old, 'entered_board', old.createdAt)];
    const history = [movement(entrant.id, 'proposal', '2026-08-10', 'new'), movement(old.id, 'signed', '2026-08-10', 'new')];
    const data = calculatePerformance([entrant, old], history, fixtureBoard, august, '', undefined, snapshot, { mode: 'period', lifecycleEvents });
    generateReportPDF(data, context);
    const progression = tables().find(table => table.head[0][0] === 'Progressão dos leads no funil');
    expect(progression.head[0][1]).toBe('Leads nesta etapa ou além');
    expect(progression.body.map((row: unknown[]) => row[1])).toEqual([1, 1, 1, 0, 0]);
    expect(JSON.stringify(tables())).toContain('mesma base de 1 leads com entrada registrada no período');
    expect(JSON.stringify(tables())).toContain('não comprova passagem pelas etapas puladas');
    expect(tables()[0].body.find((row: string[]) => row[0] === 'Ganhos')[1]).toBe('1');
  });
});
