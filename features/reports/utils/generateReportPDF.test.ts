import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Board, Deal } from '@/types';
import { calculatePerformance } from '../performanceMetrics';
import { generateReportPDF } from './generateReportPDF';

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
});
