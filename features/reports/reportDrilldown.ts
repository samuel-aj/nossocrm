import type { Deal } from '@/types';
import type { PerformanceMetrics } from './performanceMetrics';
import { lossReasonLabel } from '@/lib/utils/lossDetails';
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
  | { kind: 'revenue' | 'qualification' | 'closing' | 'cycle' | 'closures' }
  | { kind: 'loss'; category?: 'qualified' | 'disqualified' | 'unknown'; reason?: string }
  | { kind: 'owner'; ownerId: string; ownerName: string };
export interface ReportLeadGroup { id: string; label: string; description: string; deals: Deal[] }
export function reportDrilldown(metrics: PerformanceMetrics & { deals: Deal[] }, selection: ReportSelection) {
  const won: ReportLeadGroup = { id: 'won', label: 'Ganhos', description: 'Ganhos pela data de encerramento no período, incluindo leads criados em outros meses.', deals: metrics.wonDeals };
  const qualified: ReportLeadGroup = { id: 'qualified', label: 'Qualificados', description: 'Primeira qualificação comprovada no período, incluindo leads criados em outros meses. Datas estimadas não entram no cálculo.', deals: metrics.deals.filter(deal => metrics.qualifiedIds.has(deal.id)) };
  const entries: ReportLeadGroup = { id: 'entries', label: 'Total de leads', description: 'Leads criados no período selecionado.', deals: metrics.entries };
  const qualifiedLost: ReportLeadGroup = { id: 'qualified-lost', label: 'Perdas qualificadas', description: 'Perdas encerradas no período e classificadas como qualificadas.', deals: metrics.lostDeals.filter(deal => deal.lossCategory === 'qualified') };
  switch (selection.kind) {
    case 'revenue': return { title: 'Faturamento fechado', groups: [won], showRevenue: true };
    case 'qualification': return { title: 'Taxa de Qualificação', groups: [qualified, entries], formula: `${metrics.qualifiedCount} qualificados ÷ ${metrics.entries.length} leads criados` };
    case 'closing': return { title: 'Taxa de Fechamento', groups: [won, qualified], formula: `${metrics.wonDeals.length} ganhos ÷ ${metrics.qualifiedCount} qualificados` };
    case 'closures': return { title: 'Fechamentos', groups: [won, qualifiedLost] };
    case 'cycle': return { title: 'Ciclo Médio', groups: [{ ...won, deals: won.deals.filter(deal => salesCycleDays(deal) !== null) }], showCycle: true };
    case 'owner': return { title: `Ganhos · ${selection.ownerName}`, groups: [{ ...won, deals: won.deals.filter(deal => (deal.ownerId || 'unassigned') === selection.ownerId) }], showRevenue: true };
    case 'loss': {
      const label = selection.category === 'qualified' ? 'Perdas qualificadas' : selection.category === 'disqualified' ? 'Desqualificações' : selection.category === 'unknown' ? 'Perdas sem classificação' : 'Perdas no Período';
      const deals = metrics.lostDeals.filter(deal => (!selection.category || (selection.category === 'unknown' ? !deal.lossCategory : deal.lossCategory === selection.category)) && (selection.reason === undefined || lossReasonLabel(deal.lossReason) === selection.reason));
      return { title: selection.reason === undefined ? label : `${label} · ${selection.reason}`, groups: [{ id: 'lost', label, description: 'Perdas pela data de encerramento no período selecionado.', deals }], showLoss: true };
    }
  }
}
