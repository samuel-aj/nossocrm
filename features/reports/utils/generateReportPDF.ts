import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PerformanceMetrics } from '../performanceMetrics';
import { groupLossReasons } from '@/lib/utils/lossDetails';
import { REPORT_MODES, formatReportRate, type ReportMode } from '../reportPresentation';

export interface ReportContext { mode?: ReportMode; boardName: string; period: string; range: string; owner: string; product?: string; generatedBy: string }

export function generateReportPDF(data: PerformanceMetrics & { webhookUnavailable?: boolean }, context: ReportContext) {
  const doc = new jsPDF();
  const mode = context.mode || data.mode;
  const info = REPORT_MODES[mode];
  const cohort = mode === 'cohort';
  const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateScope = mode === 'current' ? 'Carteira de agora; período não se aplica' : `${context.period} | ${context.range} | Apuração até ${new Date(data.cutoffDate).toLocaleDateString('pt-BR')}`;
  doc.setFontSize(20);
  doc.text('Relatório de Performance', 14, 20);
  doc.setFontSize(10);
  const headerLines = doc.splitTextToSize(`${context.boardName} | ${info.label}\n${dateScope}\n${context.owner} | Produto: ${context.product || 'Todos os produtos'}\nGerado por ${context.generatedBy} em ${new Date().toLocaleString('pt-BR')}`, 180);
  doc.text(headerLines, 14, 29);
  const body: string[][] = mode === 'current' ? [
    ['Negócios abertos', String(data.currentDeals.length), 'Estado atual'],
    ['Valor da carteira aberta', money(data.currentValue), 'Negócios abertos agora'],
  ] : [
    ['Entradas', String(data.entries.length), cohort ? 'Leads criados no intervalo e presentes no funil até o corte' : 'Entrada registrada no funil no intervalo'],
    ['Qualificados', String(data.qualifiedCount), cohort ? 'Qualificação comprovada dos leads do grupo até o corte' : 'Primeira qualificação comprovada no intervalo'],
    ...(cohort ? [
      ['Taxa de qualificação', formatReportRate(data.qualificationRate), `${data.qualifiedCount} qualificados / ${data.entries.length} leads do mesmo grupo`],
      ['Taxa de fechamento', formatReportRate(data.closingRate), `${data.cohortWonDeals.length} ganhos entre os qualificados / ${data.qualifiedCount} qualificados do mesmo grupo; ${data.wonDeals.length - data.cohortWonDeals.length} ganhos sem qualificação prévia comprovada ficam fora da taxa`],
    ] : []),
    ['Ganhos', String(data.wonDeals.length), cohort ? 'Ganhos comprovados do grupo até o corte' : 'Ganhos pela data do acontecimento'],
    [cohort ? 'Valor ganho pelos leads do grupo' : 'Faturamento fechado', money(data.wonRevenue), 'Valor registrado nos ganhos'],
    ...(!cohort ? [['Variação do faturamento', formatReportRate(data.revenueChange), 'vs período anterior']] : []),
    ['Perdas qualificadas', String(data.lostDeals.filter(d => d.lossCategory === 'qualified').length), cohort ? 'Perdas do grupo até o corte' : 'Data do acontecimento'],
    ['Perdas desqualificadas', String(data.lostDeals.filter(d => d.lossCategory === 'disqualified').length), cohort ? 'Perdas do grupo até o corte' : 'Data do acontecimento'],
    ['Perdas sem classificação', String(data.lostDeals.filter(d => !d.lossCategory).length), 'Sem categoria registrada'],
    ['Reaberturas', String(data.reopenedDeals.length), 'Leads distintos com reabertura registrada'],
    ['Ciclo médio dos ganhos', data.avgSalesCycle === null ? '—' : `${data.avgSalesCycle} dias`, data.fastestSalesCycle == null ? 'Sem ganhos com duração comprovada' : `Rápido: ${data.fastestSalesCycle}d | Lento: ${data.slowestSalesCycle}d`],
  ];
  autoTable(doc, { startY: 29 + headerLines.length * 4.5 + 6, head: [['Indicador', 'Resultado', 'Base']], body, styles: { fontSize: 9 }, headStyles: { fillColor: [30, 41, 59] } });
  autoTable(doc, { head: [[info.chartTitle, 'Leads distintos', 'Percentual / Base']], body: data.stageData.map(stage => [stage.name, stage.count,
    stage.conversionRate == null ? '—' : `${formatReportRate(stage.conversionRate)} · ${stage.comparisonBase}`]), styles: { fontSize: 9 } });
  const reasonRows: (string | number)[][] = [];
  for (const category of ['qualified', 'disqualified', undefined]) {
    const deals = data.lostDeals.filter(deal => deal.lossCategory === category || (!category && !deal.lossCategory));
    const label = category === 'qualified' ? 'Qualificados' : category === 'disqualified' ? 'Desqualificados' : 'Sem classificação';
    for (const group of groupLossReasons(deals).sort((a, b) => b.count - a.count)) reasonRows.push([label, group.label, group.count, formatReportRate(group.count / deals.length * 100)]);
  }
  if (reasonRows.length) autoTable(doc, { head: [['Classificação', 'Motivo agrupado', 'Leads', '% da categoria']], body: reasonRows, styles: { fontSize: 9 } });
  const coverage = data.coverage;
  autoTable(doc, { head: [['Como ler este relatório']], body: [
    [info.description],
    [cohort ? 'Qualificação: qualificados / leads do mesmo grupo. Fechamento: ganhos entre os qualificados / qualificados do mesmo grupo. Sem denominador: traço.' : mode === 'period' ? 'Os volumes usam as datas de cada acontecimento; não são taxas de conversão. Um lead pode ter perda, reabertura e ganho no mesmo intervalo.' : 'Cada negócio aberto aparece na sua etapa atual.'],
    ...(mode !== 'current' ? [
      ['Gráfico: somente chegadas comprovadas. Saltos não criam visitas intermediárias. Percentuais, quando presentes, mostram leads da etapa que também chegaram à próxima.'],
      [`Histórico: ${coverage.unknownQualificationCount} qualificações sem data; ${coverage.estimatedQualificationCount} com data estimada; ${coverage.unknownClosureCount} encerramentos sem data; ${coverage.unknownBoardMembershipCount} leads sem comprovação de presença histórica no funil. Estimativas não entram nas taxas nem nos volumes datados.`],
      [`${coverage.legacySnapshotCount} leads têm dados históricos incompletos: alguns campos usam o cadastro atual ou o registro anterior disponível. No grupo de captação, o responsável é o da entrada e o produto é o associado atualmente (editar produtos pode mudar o grupo filtrado). Nos resultados por período, os filtros usam o instante do acontecimento; produtos adicionados depois não alteram eventos anteriores.`],
    ] : []),
    ['Motivos agrupados por grafia e aliases de contato repetido; os textos originais continuam disponíveis no detalhamento do CRM.'],
  ], styles: { fontSize: 9 } });
  doc.save(`performance-${mode}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
