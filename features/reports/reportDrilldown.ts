import type { Deal } from '@/types';
import type { PerformanceMetrics } from './performanceMetrics';
import { lossReasonGroupKey, lossReasonGroupLabel } from '@/lib/utils/lossDetails';
import { LEAD_SOURCE_BASE, LEAD_SOURCE_HISTORY_NOTE } from './leadSourceReport';
export { lossCategoryLabel, lossReasonLabel } from '@/lib/utils/lossDetails';

export const NO_PRODUCT = '__none__';
export const salesCycleDays = (deal: Deal) => {
  const days = (Date.parse(deal.closedAt || '') - Date.parse(deal.createdAt)) / 86400000;
  return Number.isFinite(days) && days >= 0 ? days : null;
};
export function filterReportProducts(deals: Deal[], productId: string) {
  return deals.filter(deal => !productId || (productId === NO_PRODUCT
    ? !deal.items.some(item => item.productId)
    : deal.items.some(item => item.productId === productId)));
}
export type ReportSelection =
  | { kind: 'revenue' | 'qualification' | 'closing' | 'total-conversion' | 'cycle' | 'closures' | 'entries' | 'worked' | 'reopened' | 'diagnostics' }
  | { kind: 'loss'; category?: 'qualified' | 'disqualified' | 'unknown'; reason?: string; reasonKey?: string }
  | { kind: 'source'; keys?: string[] }
  | { kind: 'owner'; ownerId: string; ownerName: string };
export interface ReportLeadGroup { id: string; label: string; description: string; deals: Deal[] }
export interface ReportDrilldown {
  title: string; groups: ReportLeadGroup[]; formula?: string; showRevenue?: boolean; showCycle?: boolean; showLoss?: boolean;
  contextDescription?: string; dateBasisLabel?: string; showSource?: boolean;
  stageColumnLabel?: string; closureColumnLabel?: string; unknownQualificationLabel?: string;
  qualificationEvidenceByDeal?: Map<string, { kind: 'qualification' | 'stage'; date: string; stageId?: string; stageName: string }>;
  diagnosticReasonsByDeal?: Map<string, string[]>;
}
export function reportDrilldown(metrics: PerformanceMetrics & { deals: Deal[] }, selection: ReportSelection): ReportDrilldown {
  const cohort = metrics.mode === 'cohort';
  const conversion = metrics.mode === 'conversion';
  const monthly = metrics.mode === 'monthly';
  const showsRates = cohort || conversion || monthly;
  const closingBasis = monthly ? 'Ganhos mantidos: negócios que continuam ganhos, sem perda ou reabertura atual, com encerramento registrado no período. A data do ganho registrado, inclusive um fechamento legado no protocolo, não comprova a data da assinatura.' : metrics.usesCustomerPromotion ? 'Primeira promoção comprovada a Cliente em cada episódio; avanços posteriores como protocolo não mudam a data do ganho.' : 'Primeiro ganho registrado em cada episódio de encerramento.';
  const showsWins = ['revenue', 'closing', 'total-conversion', 'cycle', 'closures', 'owner'].includes(selection.kind);
  const context = {
    contextDescription: monthly ? 'A base das taxas, origens e etapas iniciais contém somente leads com entrada registrada no funil no período, selecionados pelos dados da entrada. Os detalhes preservam os registros históricos disponíveis. Ganhos do período são apurados pelo estado atual e pelo encerramento no período; usam responsável, produtos e valores atuais. Ganhos fora da base não aumentam as entradas ou os numeradores das taxas. A prova de qualificação não inventa a data desconhecida da primeira qualificação.' : conversion ? 'Mesmos leads com entrada registrada no funil no período, apurados até a data de corte. Responsável e produto são os da entrada selecionada. Qualificados e ganhos usam os mesmos IDs dos marcos do gráfico; etapas puladas não comprovam qualificação ou ganho.' : cohort ? 'Mesma coorte de leads criados no período, apurada até a data de corte. O responsável vem da primeira presença registrada no funil; o filtro de produto usa os vínculos atuais. Os resultados mostram os dados do evento.' :
      metrics.mode === 'period' ? 'Acontecimentos no período; cada volume usa sua própria data e os dados registrados no evento. Não são taxas de conversão.' : 'Carteira aberta no estado atual.',
    dateBasisLabel: metrics.mode === 'current' ? 'Estado atual' : monthly && showsWins ? 'Data do ganho registrado' : showsWins && metrics.usesCustomerPromotion ? 'Data da promoção a Cliente' : 'Data do acontecimento',
    ...(monthly ? { stageColumnLabel: 'Etapa', closureColumnLabel: 'Encerramento registrado', unknownQualificationLabel: 'Sem data registrada', qualificationEvidenceByDeal: metrics.qualificationEvidenceByDeal } : {}),
  };
  context.contextDescription += metrics.mode === 'current' || !showsWins ? '' : ` ${closingBasis}`;
  const won: ReportLeadGroup = { id: 'won', label: monthly ? 'Ganhos do período' : 'Ganhos', description: monthly ? 'Todos os ganhos mantidos com encerramento registrado no período, inclusive captações anteriores ou sem qualificação comprovada. São os mesmos leads do marco Ganhos do período, do faturamento e de Fechamentos. Os ganhos fora da base de entradas não participam das taxas.' : conversion ? 'Ganhos comprovados entre os qualificados da base de entradas. Cada lead conta uma vez; protocolo não gera outro ganho.' : cohort ? 'Ganhos de leads da coorte registrados até o corte.' : 'Ganhos registrados no período, incluindo leads criados antes dele.', deals: metrics.wonDeals };
  const qualified: ReportLeadGroup = { id: 'qualified', label: 'Qualificados', description: monthly ? 'Leads da base de entradas do período com qualificação comprovada até o corte. Uma data de avanço não substitui a data desconhecida da primeira qualificação. Captações fora desta base não entram neste denominador.' : conversion ? 'Leads da base de entradas com qualificação comprovada e válida para esta jornada até o corte. Estimativas e a posição atual isolada não contam como prova.' : cohort ? 'Leads da coorte com qualificação observada até o corte. Estimativas ficam fora da taxa.' : 'Primeira qualificação observada no período. Estimativas ficam fora deste volume.', deals: metrics.qualifiedDeals };
  const entries: ReportLeadGroup = { id: 'entries', label: metrics.mode === 'current' ? 'Carteira aberta' : 'Entradas', description: cohort ? 'Leads criados no período e com presença comprovada neste funil até o corte.' : metrics.mode === 'current' ? 'Leads abertos no funil agora.' : 'Leads com entrada registrada no funil no período. No histórico antigo, inclui a chegada inicial registrada pelo banco: criação, transferência ou primeira atribuição de etapa. A data usada é a do registro, não uma estimativa da criação.', deals: metrics.entries };
  const qualifiedLost: ReportLeadGroup = { id: 'qualified-lost', label: 'Perdas qualificadas', description: 'Perdas registradas nesta base e classificadas como qualificadas.', deals: metrics.lostDeals.filter(deal => deal.lossCategory === 'qualified') };
  const rateBase = entries;
  const entryWins: ReportLeadGroup = { id: 'entry-won', label: 'Ganhos da base de entradas', description: 'Ganhos do período que pertencem à base de entradas do período. Este grupo é o numerador da conversão total; inclui ganhos da base sem qualificação prévia comprovada.', deals: metrics.entryWonDeals };
  const outsideEntryWins: ReportLeadGroup = { id: 'outside-entry-won', label: 'Ganhos fora da base de entradas', description: 'Ganhos do período cuja entrada não pertence à base selecionada. Continuam nos contratos e no faturamento; não aumentam a base de leads, origens ou as taxas de conversão. Estar fora da base não significa ausência de qualificação.', deals: metrics.outsideEntryWonDeals };
  const unqualifiedWins: ReportLeadGroup = { id: 'unqualified-won', label: 'Ganhos sem qualificação prévia', description: 'Continuam no total de ganhos e no faturamento. Ficam fora apenas do numerador da taxa de fechamento por não haver qualificação comprovada antes do ganho; uma qualificação posterior não entra nesse numerador.', deals: metrics.unqualifiedWonDeals };
  switch (selection.kind) {
    case 'diagnostics': return { ...context, title: 'Registros para revisão',
      groups: [{ id: 'diagnostics', label: 'Registros para revisão', description: monthly ? 'Lacunas de histórico para conferência. Ganhos sem qualificação comprovada continuam nos contratos e no faturamento; a falta de MQL afeta apenas a taxa de fechamento.' : 'Os motivos abaixo explicam por que estes registros não compõem um ou mais indicadores. A lista não acrescenta entradas, qualificações ou ganhos.', deals: metrics.diagnosticsDeals }],
      diagnosticReasonsByDeal: metrics.diagnosticReasonsByDeal };
    case 'source': {
      const sourceGroups = metrics.leadSourceGroups.filter(group => !selection.keys || selection.keys.includes(group.key));
      const deals = sourceGroups.flatMap(group => group.deals);
      const label = sourceGroups.length === 1 ? sourceGroups[0].label : selection.keys ? 'Outros (agrupados)' : 'Todas as origens';
      const groups = sourceGroups.map(group => ({ id: group.key, label: group.label,
        description: `${group.count} de ${metrics.leadSourceTotal} leads da base selecionada.`, deals: group.deals }));
      if (groups.length !== 1) groups.unshift({ id: 'all-sources', label, description: LEAD_SOURCE_BASE[metrics.mode], deals });
      return { ...(monthly ? context : {}), title: `Origem dos leads · ${label}`, groups, showSource: true,
        contextDescription: `${LEAD_SOURCE_BASE[metrics.mode]} Não informado também conta no denominador.${metrics.coverage.legacyLeadSourceSnapshotCount > 0 ? ` ${LEAD_SOURCE_HISTORY_NOTE}` : ''}`,
        dateBasisLabel: metrics.mode === 'current' ? 'Origem do cadastro atual' : 'Origem registrada na entrada ou na primeira presença comprovada no funil',
        formula: `${deals.length} leads selecionados ÷ ${metrics.leadSourceTotal} leads da base` };
    }
    case 'entries': return { ...context, title: cohort ? 'Leads da coorte' : metrics.mode === 'current' ? 'Carteira aberta' : 'Entradas no funil', groups: [entries] };
    case 'worked': return { ...context, title: 'Entradas no funil', groups: [entries] };
    case 'reopened': return { ...context, title: 'Reaberturas', groups: [{ id: 'reopened', label: 'Reabertos', description: conversion ? 'Leads da base com reabertura registrada após a entrada selecionada e até o corte.' : cohort ? 'Leads da coorte com reabertura registrada até o corte.' : 'Leads distintos com reabertura registrada no período.', deals: metrics.reopenedDeals }] };
    case 'revenue': return { ...context, title: metrics.mode === 'current' ? 'Valor da carteira' : 'Faturamento fechado', groups: metrics.mode === 'current' ? [{ ...entries, deals: metrics.currentDeals }] : [won], showRevenue: true };
    case 'qualification': return { ...context, title: showsRates ? 'Taxa de Qualificação' : 'Qualificações no período', groups: showsRates ? [qualified, rateBase] : [qualified], formula: showsRates ? `${metrics.qualifiedCount} qualificados ÷ ${rateBase.deals.length} ${monthly || conversion ? 'entradas no funil' : 'leads da coorte'}` : undefined };
    case 'closing': return { ...context, title: showsRates ? 'Taxa de Fechamento' : 'Ganhos no período', groups: showsRates ? [{ ...won, label: 'Ganhos entre os qualificados', deals: metrics.cohortWonDeals, ...(monthly ? { description: 'Ganhos da base de entradas com qualificação comprovada até o fechamento. Este subconjunto é o numerador da taxa; os demais ganhos continuam disponíveis no total do período.' } : {}) }, qualified, ...(monthly ? [{ ...won, id: 'all-won' }, outsideEntryWins, unqualifiedWins] : [])] : [won], formula: showsRates ? `${metrics.cohortWonDeals.length} ganhos entre os qualificados ÷ ${metrics.qualifiedCount} qualificados ${monthly ? `da base de entradas. Total do período: ${metrics.wonDeals.length} ganhos, incluindo ${metrics.outsideEntryWonDeals.length} fora da base. ${metrics.unqualifiedWonDeals.length} ganhos da base sem qualificação prévia comprovada ficam fora desta taxa` : conversion ? 'da base de entradas' : 'da coorte'}` : undefined };
    case 'total-conversion': return { ...context, title: 'Conversão total', groups: [monthly ? entryWins : { ...won, label: 'Ganhos entre os qualificados', deals: metrics.cohortWonDeals }, rateBase], formula: monthly ? `${metrics.entryWonDeals.length} ganhos da base de entradas ÷ ${entries.deals.length} entradas no funil` : `${metrics.cohortWonDeals.length} ganhos entre os qualificados ÷ ${metrics.entries.length} ${conversion ? 'entradas no funil' : 'leads da coorte'}` };
    case 'closures': return { ...context, title: 'Fechamentos', groups: monthly ? [won, entryWins, outsideEntryWins, qualifiedLost, entries] : conversion ? [won, qualifiedLost, rateBase] : [won, qualifiedLost],
      formula: monthly ? `Total do período: ${metrics.wonDeals.length} ganhos, incluindo ${metrics.outsideEntryWonDeals.length} fora da base. Conversão total da base: ${metrics.entryWonDeals.length} ganhos ÷ ${entries.deals.length} entradas no funil` : conversion ? `Conversão total: ${metrics.cohortWonDeals.length} ganhos entre os qualificados ÷ ${metrics.entries.length} entradas no funil` : undefined };
    case 'cycle': return { ...context, title: 'Ciclo Médio', groups: [{ ...won, deals: won.deals.filter(deal => salesCycleDays(deal) !== null) }], showCycle: true };
    case 'owner': return { ...context, title: `Ganhos · ${selection.ownerName}`, groups: [{ ...won, deals: won.deals.filter(deal => (deal.ownerId || 'unassigned') === selection.ownerId) }], showRevenue: true };
    case 'loss': {
      const label = selection.category === 'qualified' ? 'Perdas qualificadas' : selection.category === 'disqualified' ? 'Desqualificações' : selection.category === 'unknown' ? 'Perdas sem classificação' : 'Perdas no Período';
      const reasonKey = selection.reasonKey ?? (selection.reason === undefined ? undefined : lossReasonGroupKey(selection.reason));
      const deals = metrics.lostDeals.filter(deal => (!selection.category || (selection.category === 'unknown' ? !deal.lossCategory : deal.lossCategory === selection.category)) && (reasonKey === undefined || lossReasonGroupKey(deal.lossReason) === reasonKey));
      const reasonLabel = reasonKey === undefined ? undefined : deals.length ? lossReasonGroupLabel(deals[0].lossReason) : selection.reason;
      return { ...context, title: reasonLabel === undefined ? label : `${label} · ${reasonLabel}`, groups: [{ id: 'lost', label, description: conversion ? 'Perdas da base de entradas registradas após a entrada selecionada e até o corte.' : cohort ? 'Perdas da coorte registradas até o corte.' : 'Perdas registradas no período selecionado.', deals }], showLoss: true };
    }
  }
}
