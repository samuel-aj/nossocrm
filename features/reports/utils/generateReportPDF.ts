import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PerformanceMetrics } from '../performanceMetrics';

export interface ReportContext { boardName: string; period: string; range: string; owner: string; generatedBy: string }

export function generateReportPDF(data: PerformanceMetrics & { webhookUnavailable?: boolean }, context: ReportContext) {
  const doc = new jsPDF();
  const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const rate = (value: number | null) => value === null ? '-' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  doc.setFontSize(20);
  doc.text('Relatório de Performance', 14, 20);
  doc.setFontSize(10);
  doc.text(doc.splitTextToSize(`${context.boardName} | ${context.period} | ${context.range}\n${context.owner} | Quadro e responsável atuais\nGerado por ${context.generatedBy} em ${new Date().toLocaleString('pt-BR')}`, 180), 14, 29);
  autoTable(doc, { startY: 52, head: [['Indicador', 'Resultado', 'Base']], body: [
    ['Entradas', String(data.entries.length), 'Criados no período'],
    ['Qualificados', data.hasQualifiedStage ? String(data.qualifiedCount) : '-', 'Qualificação registrada no período'],
    ['Taxa de qualificação', rate(data.qualificationRate), `${data.qualifiedCount} qualificados / ${data.entries.length} entradas`],
    ['Taxa de fechamento', rate(data.closingRate), `${data.wonDeals.length} ganhos / ${data.qualifiedCount} qualificados`],
    ['Ganhos', String(data.wonDeals.length), 'Data de encerramento'],
    ['Faturamento fechado', money(data.wonRevenue), 'Ganhos do período'],
    ['Variação do faturamento', data.revenueChange == null ? '-' : rate(data.revenueChange), 'vs período anterior'],
    ['Perdas qualificadas', String(data.lostDeals.filter(d => d.lossCategory === 'qualified').length), 'Data de encerramento'],
    ['Perdas desqualificadas', String(data.lostDeals.filter(d => d.lossCategory === 'disqualified').length), 'Data de encerramento'],
    ['Perdas sem classificação', String(data.lostDeals.filter(d => !d.lossCategory).length), 'Data de encerramento'],
    ['Ciclo médio dos ganhos', data.avgSalesCycle === null ? '-' : `${data.avgSalesCycle} dias`, data.fastestSalesCycle == null ? 'Sem ganhos no período' : `Rápido: ${data.fastestSalesCycle}d | Lento: ${data.slowestSalesCycle}d`],
  ], styles: { fontSize: 9 }, headStyles: { fillColor: [30, 41, 59] } });
  autoTable(doc, { head: [['Avanços por etapa no período', 'Leads distintos', 'Percentual / Base']], body: data.stageData.map(stage => [stage.name, stage.count, rate(stage.conversionRate) + ' · ' + stage.comparisonBase]), styles: { fontSize: 9 } });
  const reasons = new Map<string, number>();
  for (const deal of data.lostDeals) {
    const category = deal.lossCategory === 'qualified' ? 'Qualificado' : deal.lossCategory === 'disqualified' ? 'Desqualificado' : 'Sem classificação';
    const key = `${category}: ${deal.lossReason || 'Não informado'}`;
    reasons.set(key, (reasons.get(key) || 0) + 1);
  }
  if (reasons.size) autoTable(doc, { head: [['Motivos de perda', 'Leads']], body: [...reasons], styles: { fontSize: 9 } });
  autoTable(doc, { head: [['Como ler este relatório']], body: [
    ['Taxas acima de 100% são válidas. Entradas, qualificações e ganhos podem ser de leads diferentes. Denominador zero: traço.'],
    ['Cada lead conta uma vez por etapa no período. Ganho usa a data de fechamento. Barras não representam conversão entre si.'],
    [`Histórico: ${data.unknownQualification.length} leads com indicação de qualificação sem data recuperável; ${data.unknownClosure.length} encerramentos sem data. Não são atribuídos a um mês por estimativa.`],
    ...(data.webhookUnavailable ? [['Histórico complementar de integrações indisponível. Foram usadas atividades registradas.']] : []),
  ], styles: { fontSize: 9 } });
  doc.save(`performance-${new Date().toISOString().slice(0, 10)}.pdf`);
}
