import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PerformanceMetrics } from '../performanceMetrics';
import { groupLossReasons } from '@/lib/utils/lossDetails';
import { REPORT_MODES, formatReportRate, type ReportMode } from '../reportPresentation';
import { LEAD_SOURCE_BASE, LEAD_SOURCE_HISTORY_NOTE } from '../leadSourceReport';

export interface ReportContext { mode?: ReportMode; boardName: string; period: string; range: string; owner: string; product?: string; customerPipeline?: boolean; generatedBy: string }

export function generateReportPDF(data: PerformanceMetrics & { webhookUnavailable?: boolean }, context: ReportContext) {
  const doc = new jsPDF();
  const mode = context.mode || data.mode;
  const info = REPORT_MODES[mode];
  const cohort = mode === 'cohort';
  const conversion = mode === 'conversion';
  const entryChart = conversion || mode === 'period';
  const winMilestone = data.usesCustomerPromotion ? 'Cliente' : 'ganho';
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
    ['Entradas', String(data.entries.length), cohort ? 'Leads criados no intervalo e presentes no funil até o corte' : 'Entrada no funil ou chegada inicial registrada pelo banco no intervalo; não é necessariamente a criação do lead'],
    ['Qualificados', String(data.qualifiedCount), conversion ? 'Qualificação comprovada e válida para os leads da base de entradas até o corte' : cohort ? 'Qualificação comprovada dos leads do grupo até o corte' : 'Primeira qualificação comprovada no intervalo'],
    ...(conversion ? [
      ['Taxa de qualificação', formatReportRate(data.qualificationRate), `${data.qualifiedCount} qualificados / ${data.entries.length} entradas no funil`],
      ['Taxa de fechamento', formatReportRate(data.closingRate), `${data.cohortWonDeals.length} ganhos entre os qualificados / ${data.qualifiedCount} qualificados da base de entradas`],
      ['Conversão total', formatReportRate(data.totalConversionRate), `${data.cohortWonDeals.length} ganhos entre os qualificados / ${data.entries.length} entradas no funil`],
    ] : []),
    ...(cohort ? [
      ['Taxa de qualificação', formatReportRate(data.qualificationRate), `${data.qualifiedCount} qualificados / ${data.entries.length} leads do mesmo grupo`],
      ['Taxa de fechamento', formatReportRate(data.closingRate), `${data.cohortWonDeals.length} ganhos entre os qualificados / ${data.qualifiedCount} qualificados do mesmo grupo; ${data.wonDeals.length - data.cohortWonDeals.length} ganhos sem qualificação prévia comprovada ficam fora da taxa`],
    ] : []),
    ['Ganhos', String(data.wonDeals.length), conversion ? `Ganhos comprovados entre os qualificados da base de entradas; mesmos IDs do marco ${winMilestone}` : cohort ? 'Ganhos comprovados do grupo até o corte' : 'Ganhos pela data do acontecimento'],
    [cohort ? 'Valor ganho pelos leads do grupo' : 'Faturamento fechado', money(data.wonRevenue), 'Valor registrado nos ganhos'],
    ...(!cohort ? [['Variação do faturamento', formatReportRate(data.revenueChange), conversion ? 'vs base de entradas do período anterior' : 'vs período anterior']] : []),
    ['Perdas qualificadas', String(data.lostDeals.filter(d => d.lossCategory === 'qualified').length), conversion ? 'Perdas da base de entradas após a entrada selecionada e até o corte' : cohort ? 'Perdas do grupo até o corte' : 'Data do acontecimento'],
    ['Perdas desqualificadas', String(data.lostDeals.filter(d => d.lossCategory === 'disqualified').length), conversion ? 'Perdas da base de entradas após a entrada selecionada e até o corte' : cohort ? 'Perdas do grupo até o corte' : 'Data do acontecimento'],
    ['Perdas sem classificação', String(data.lostDeals.filter(d => !d.lossCategory).length), 'Sem categoria registrada'],
    ['Reaberturas', String(data.reopenedDeals.length), conversion ? 'Leads da base com reabertura após a entrada selecionada e até o corte' : 'Leads distintos com reabertura registrada'],
    ['Ciclo médio dos ganhos', data.avgSalesCycle === null ? '—' : `${data.avgSalesCycle} dias`, data.fastestSalesCycle == null ? 'Sem ganhos com duração comprovada' : `Rápido: ${data.fastestSalesCycle}d | Lento: ${data.slowestSalesCycle}d`],
  ];
  autoTable(doc, { startY: 29 + headerLines.length * 4.5 + 6, head: [['Indicador', 'Resultado', 'Base']], body, styles: { fontSize: 9 }, headStyles: { fillColor: [30, 41, 59] } });
  const chartData = entryChart ? data.entryFunnel.stages : data.stageData;
  autoTable(doc, { head: [[info.chartTitle, conversion ? 'Leads da base de entradas' : mode === 'period' ? 'Leads nesta etapa ou além' : 'Leads distintos', 'Percentual / Base']], body: chartData.map(stage => [stage.name, stage.count,
    stage.conversionRate == null ? '—' : `${formatReportRate(stage.conversionRate)} · ${stage.comparisonBase}`]), styles: { fontSize: 9 } });
  autoTable(doc, { head: [['Origem do lead', 'Leads', '% da base']], body: [
    ...data.leadSourceGroups.map(group => [group.label, group.count, formatReportRate(group.percentage)]),
    ['Total da base', data.leadSourceTotal, data.leadSourceTotal ? '100,0%' : '—'],
  ], styles: { fontSize: 9 } });
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
    [`Origem dos leads: ${LEAD_SOURCE_BASE[mode]} Cada lead conta uma vez; Não informado faz parte do total.`],
    ...(mode !== 'current' ? [['A origem usa o registro histórico da entrada; na coorte, a primeira presença comprovada no funil.']] : []),
    ...(coverage.legacyLeadSourceSnapshotCount ? [[`${coverage.legacyLeadSourceSnapshotCount} ${coverage.legacyLeadSourceSnapshotCount === 1 ? 'lead tem' : 'leads têm'} origem histórica reconstruída ou indisponível. ${LEAD_SOURCE_HISTORY_NOTE}`]] : []),
    ...(!context.customerPipeline ? [['Fechamento automático = promoção para Cliente. Etapas posteriores, como protocolo, não geram outro ganho nem alteram sua data. A primeira promoção comprovada de cada jornada define o fechamento; reaberturas iniciam uma nova jornada.']] : []),
    [conversion ? 'Todos os indicadores usam a mesma base de entradas. Qualificação = qualificados / entradas. Fechamento = ganhos comprovados entre os qualificados / qualificados. Conversão total = esses mesmos ganhos / entradas. Sem denominador: traço. Um lead conta uma vez em cada conjunto.' : cohort ? 'Qualificação: qualificados / leads do mesmo grupo. Fechamento: ganhos entre os qualificados / qualificados do mesmo grupo. Sem denominador: traço.' : mode === 'period' ? 'Os volumes usam as datas de cada acontecimento; não são taxas de conversão. Um lead pode ter perda, reabertura e ganho no mesmo intervalo.' : 'Cada negócio aberto aparece na sua etapa atual.'],
    ...(mode !== 'current' ? [
      [conversion
        ? `Gráfico: mesma base de ${data.entryFunnel.baseCount} leads com entrada registrada no período. O marco de qualificação e o marco ${winMilestone} usam os mesmos IDs dos respectivos cartões e listas. Saltos não comprovam passagens intermediárias nem criam qualificação ou ganho. ${data.usesCustomerPromotion ? 'Etapas posteriores, como protocolo, não substituem a prova de promoção a Cliente.' : 'O ganho segue a regra de encerramento configurada no funil de clientes.'} Responsável e produto são os da entrada selecionada; não são reaplicados a cada avanço.`
        : mode === 'period'
        ? `Gráfico: mesma base de ${data.entryFunnel.baseCount} leads com entrada registrada no período. Cada coluna inclui quem alcançou a etapa ou uma posterior, pela ordem atual do funil, da primeira entrada selecionada até o corte. Retornos e reaberturas não duplicam leads. Essa leitura não comprova passagem pelas etapas puladas nem cria qualificação, assinatura ou ganho. Responsável e produto são os registrados na entrada selecionada; não são reaplicados a cada avanço.`
        : 'Gráfico: somente chegadas comprovadas. Saltos não criam visitas intermediárias. Percentuais, quando presentes, mostram leads da etapa que também chegaram à próxima.'],
      ...(entryChart && data.entryFunnel.unknownStageCount ? [[`${data.entryFunnel.unknownStageCount} entradas sem etapa válida para este gráfico ficam fora das colunas, mas continuam na base de entradas e origens.`]] : []),
      ...(conversion && data.diagnosticsDeals.length ? [[`${data.diagnosticsDeals.length} registros para revisão estão disponíveis no detalhamento do CRM. ${data.unqualifiedWonDeals.length} ganhos não têm qualificação prévia válida para compor a conversão; ${data.excludedQualificationDeals.length} registros de qualificação ficaram fora do conjunto qualificado. Os grupos podem se sobrepor e não são somados aos indicadores.`]] : []),
      [`Histórico: ${coverage.unknownQualificationCount} qualificações sem data; ${coverage.estimatedQualificationCount} com data estimada; ${coverage.unknownClosureCount} encerramentos sem data; ${coverage.unknownBoardMembershipCount} leads sem comprovação de presença histórica no funil. Estimativas não entram nas taxas nem nos volumes datados.`],
      [conversion ? `${coverage.legacySnapshotCount} leads têm dados históricos incompletos: alguns campos usam o cadastro atual ou o registro anterior disponível. A base é selecionada pelos dados da entrada, não pelos dados de cada avanço. A data original da qualificação é preservada quando uma qualificação anterior é confirmada para a entrada selecionada.` : `${coverage.legacySnapshotCount} leads têm dados históricos incompletos: alguns campos usam o cadastro atual ou o registro anterior disponível. No grupo de captação, o responsável é o da entrada e o produto é o associado atualmente (editar produtos pode mudar o grupo filtrado). Nos resultados por período, os filtros usam o instante do acontecimento; produtos adicionados depois não alteram eventos anteriores.`],
    ] : []),
    ['Motivos agrupados por grafia e aliases de contato repetido; os textos originais continuam disponíveis no detalhamento do CRM.'],
  ], styles: { fontSize: 9 } });
  doc.save(`performance-${mode}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
