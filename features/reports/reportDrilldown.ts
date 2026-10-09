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
  | { kind: 'revenue' | 'qualification' | 'closing' | 'cycle' | 'closures' | 'entries' | 'reopened' }
  | { kind: 'loss'; category?: 'qualified' | 'disqualified' | 'unknown'; reason?: string; reasonKey?: string }
  | { kind: 'source'; keys?: string[] }
  | { kind: 'owner'; ownerId: string; ownerName: string };
export interface ReportLeadGroup { id: string; label: string; description: string; deals: Deal[] }
export interface ReportDrilldown {
  title: string; groups: ReportLeadGroup[]; formula?: string; showRevenue?: boolean; showCycle?: boolean; showLoss?: boolean;
  contextDescription?: string; dateBasisLabel?: string; showSource?: boolean;
}
export function reportDrilldown(metrics: PerformanceMetrics & { deals: Deal[] }, selection: ReportSelection): ReportDrilldown {
  const cohort = metrics.mode === 'cohort';
  const closingBasis = metrics.usesCustomerPromotion ? 'Primeira promoção comprovada a Cliente em cada episódio; avanços posteriores como protocolo não mudam a data do ganho.' : 'Primeiro ganho registrado em cada episódio de encerramento.';
  const showsWins = ['revenue', 'closing', 'cycle', 'closures', 'owner'].includes(selection.kind);
  const context = {
    contextDescription: cohort ? 'Mesma coorte de leads criados no período, apurada até a data de corte. O responsável vem da primeira presença registrada no funil; o filtro de produto usa os vínculos atuais. Os resultados mostram os dados do evento.' :
      metrics.mode === 'period' ? 'Acontecimentos no período; cada volume usa sua própria data e os dados registrados no evento. Não são taxas de conversão.' : 'Carteira aberta no estado atual.',
    dateBasisLabel: metrics.mode === 'current' ? 'Estado atual' : showsWins && metrics.usesCustomerPromotion ? 'Data da promoção a Cliente' : 'Data do acontecimento',
  };
  context.contextDescription += metrics.mode === 'current' || !showsWins ? '' : ` ${closingBasis}`;
  const won: ReportLeadGroup = { id: 'won', label: 'Ganhos', description: cohort ? 'Ganhos de leads da coorte registrados até o corte.' : 'Ganhos registrados no período, incluindo leads criados antes dele.', deals: metrics.wonDeals };
  const qualified: ReportLeadGroup = { id: 'qualified', label: 'Qualificados', description: cohort ? 'Leads da coorte com qualificação observada até o corte. Estimativas ficam fora da taxa.' : 'Primeira qualificação observada no período. Estimativas ficam fora deste volume.', deals: metrics.qualifiedDeals };
  const entries: ReportLeadGroup = { id: 'entries', label: metrics.mode === 'current' ? 'Carteira aberta' : 'Entradas', description: cohort ? 'Leads criados no período e com presença comprovada neste funil até o corte.' : metrics.mode === 'current' ? 'Leads abertos no funil agora.' : 'Leads com entrada registrada no funil no período.', deals: metrics.entries };
  const qualifiedLost: ReportLeadGroup = { id: 'qualified-lost', label: 'Perdas qualificadas', description: 'Perdas registradas nesta base e classificadas como qualificadas.', deals: metrics.lostDeals.filter(deal => deal.lossCategory === 'qualified') };
  switch (selection.kind) {
    case 'source': {
      const sourceGroups = metrics.leadSourceGroups.filter(group => !selection.keys || selection.keys.includes(group.key));
      const deals = sourceGroups.flatMap(group => group.deals);
      const label = sourceGroups.length === 1 ? sourceGroups[0].label : selection.keys ? 'Outros (agrupados)' : 'Todas as origens';
      const groups = sourceGroups.map(group => ({ id: group.key, label: group.label,
        description: `${group.count} de ${metrics.leadSourceTotal} leads da base selecionada.`, deals: group.deals }));
      if (groups.length !== 1) groups.unshift({ id: 'all-sources', label, description: LEAD_SOURCE_BASE[metrics.mode], deals });
      return { title: `Origem dos leads · ${label}`, groups, showSource: true,
        contextDescription: `${LEAD_SOURCE_BASE[metrics.mode]} Não informado também conta no denominador.${metrics.coverage.legacyLeadSourceSnapshotCount > 0 ? ` ${LEAD_SOURCE_HISTORY_NOTE}` : ''}`,
        dateBasisLabel: metrics.mode === 'current' ? 'Origem do cadastro atual' : 'Origem registrada na entrada ou na primeira presença comprovada no funil',
        formula: `${deals.length} leads selecionados ÷ ${metrics.leadSourceTotal} leads da base` };
    }
    case 'entries': return { ...context, title: cohort ? 'Leads da coorte' : metrics.mode === 'current' ? 'Carteira aberta' : 'Entradas no funil', groups: [entries] };
    case 'reopened': return { ...context, title: 'Reaberturas', groups: [{ id: 'reopened', label: 'Reabertos', description: cohort ? 'Leads da coorte com reabertura registrada até o corte.' : 'Leads distintos com reabertura registrada no período.', deals: metrics.reopenedDeals }] };
    case 'revenue': return { ...context, title: metrics.mode === 'current' ? 'Valor da carteira' : 'Faturamento fechado', groups: metrics.mode === 'current' ? [{ ...entries, deals: metrics.currentDeals }] : [won], showRevenue: true };
    case 'qualification': return { ...context, title: cohort ? 'Taxa de Qualificação' : 'Qualificações no período', groups: cohort ? [qualified, entries] : [qualified], formula: cohort ? `${metrics.qualifiedCount} qualificados ÷ ${metrics.entries.length} leads da coorte` : undefined };
    case 'closing': return { ...context, title: cohort ? 'Taxa de Fechamento' : 'Ganhos no período', groups: cohort ? [{ ...won, label: 'Ganhos entre os qualificados', deals: metrics.cohortWonDeals }, qualified] : [won], formula: cohort ? `${metrics.cohortWonDeals.length} ganhos entre os qualificados ÷ ${metrics.qualifiedCount} qualificados da coorte` : undefined };
    case 'closures': return { ...context, title: 'Fechamentos', groups: [won, qualifiedLost] };
    case 'cycle': return { ...context, title: 'Ciclo Médio', groups: [{ ...won, deals: won.deals.filter(deal => salesCycleDays(deal) !== null) }], showCycle: true };
    case 'owner': return { ...context, title: `Ganhos · ${selection.ownerName}`, groups: [{ ...won, deals: won.deals.filter(deal => (deal.ownerId || 'unassigned') === selection.ownerId) }], showRevenue: true };
    case 'loss': {
      const label = selection.category === 'qualified' ? 'Perdas qualificadas' : selection.category === 'disqualified' ? 'Desqualificações' : selection.category === 'unknown' ? 'Perdas sem classificação' : 'Perdas no Período';
      const reasonKey = selection.reasonKey ?? (selection.reason === undefined ? undefined : lossReasonGroupKey(selection.reason));
      const deals = metrics.lostDeals.filter(deal => (!selection.category || (selection.category === 'unknown' ? !deal.lossCategory : deal.lossCategory === selection.category)) && (reasonKey === undefined || lossReasonGroupKey(deal.lossReason) === reasonKey));
      const reasonLabel = reasonKey === undefined ? undefined : deals.length ? lossReasonGroupLabel(deals[0].lossReason) : selection.reason;
      return { ...context, title: reasonLabel === undefined ? label : `${label} · ${reasonLabel}`, groups: [{ id: 'lost', label, description: cohort ? 'Perdas da coorte registradas até o corte.' : 'Perdas registradas no período selecionado.', deals }], showLoss: true };
    }
  }
}
