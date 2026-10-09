import type { Board, Deal } from '@/types';
import { compareHistoricalDates, matchesReportFilters } from './performanceHistory';
import type { EntryFunnel, EntryFunnelEvidence, EntryFunnelStage } from './entryFunnel';

export interface MonthlyQualificationEvidence { kind: 'qualification' | 'stage'; date: string; stageId?: string; stageName: string }
interface MonthlyInput {
  deals: readonly Deal[]; board: Board; startDate: string; cutoffDate: string; ownerId?: string; productId?: string;
  entries: Deal[]; qualifiedDeals: Deal[]; qualificationDates: Map<string, string>; qualificationConfirmedDates: Map<string, string>;
  leadQualificationDates: Map<string, string>;
  entryFunnel: EntryFunnel; hasQualifiedStage: boolean;
  diagnosticReasonsByDeal: Map<string, string[]>; diagnosticsDeals: Deal[]; excludedQualificationDeals: Deal[];
}
const rate = (numerator: number, denominator: number) => denominator ? numerator / denominator * 100 : null;

/** A deliberately narrow overlay on the existing conversion report.
 * Entry snapshots, qualification, losses, filters, sources and pre-gain progress
 * remain the caller's baseline. Only the retained-gain population uses today's
 * explicit outcome and closedAt; CUSTOMER visits never create a gain.
 */
export function calculateMonthlyResults(input: MonthlyInput) {
  const { board, entries, qualifiedDeals, startDate, cutoffDate } = input;
  const valid = (date?: string): date is string => !!date && Number.isFinite(Date.parse(date));
  const validForLead = (date: string | undefined, createdAt: string): date is string => valid(date) && valid(createdAt) &&
    compareHistoricalDates(date, createdAt) >= 0 && compareHistoricalDates(date, cutoffDate) <= 0;
  const wonDeals = input.deals.filter(deal => deal.boardId === board.id && deal.isWon && !deal.isLost &&
    validForLead(deal.closedAt, deal.createdAt) && compareHistoricalDates(deal.closedAt, startDate) >= 0 &&
    matchesReportFilters(deal, input.ownerId || '', input.productId || ''));
  const entryIds = new Set(entries.map(deal => deal.id));
  const qualifiedIds = new Set(qualifiedDeals.map(deal => deal.id));
  const entryWonDeals = wonDeals.filter(deal => entryIds.has(deal.id));
  const outsideEntryWonDeals = wonDeals.filter(deal => !entryIds.has(deal.id));
  const cohortWonDeals = entryWonDeals.filter(deal => {
    const date = input.qualificationDates.get(deal.id);
    const confirmed = input.qualificationConfirmedDates.get(deal.id) || date;
    return qualifiedIds.has(deal.id) && !!date && !!confirmed && compareHistoricalDates(date, deal.closedAt!) <= 0 &&
      compareHistoricalDates(confirmed, deal.closedAt!) <= 0;
  });
  const qualifiedWinIds = new Set(cohortWonDeals.map(deal => deal.id));
  const unqualifiedWonDeals = entryWonDeals.filter(deal => !qualifiedWinIds.has(deal.id));
  const wonIds = new Set(wonDeals.map(deal => deal.id));
  const qualificationEvidenceByDeal = new Map<string, MonthlyQualificationEvidence>();
  const leadQualificationDates = input.leadQualificationDates;
  for (const [id, date] of input.qualificationDates) qualificationEvidenceByDeal.set(id, { kind: 'qualification', date, stageName: 'Qualificação registrada' });
  // Missing baseline metadata for an outside-entry gain is an unknown date,
  // not an assertion that the lead never qualified. Do not re-read raw imports.
  const excludedIds = new Set(input.excludedQualificationDeals.map(deal => deal.id));
  // Old diagnostics about a missing canonical CUSTOMER win are resolved by the
  // retained-gain record. Preserve contradicted qualification evidence.
  const diagnosticReasonsByDeal = new Map([...input.diagnosticReasonsByDeal].filter(([id]) => !wonIds.has(id) || excludedIds.has(id)));
  const diagnose = (id: string, reason: string) => diagnosticReasonsByDeal.set(id, [...(diagnosticReasonsByDeal.get(id) || []), reason]);
  for (const deal of unqualifiedWonDeals) diagnose(deal.id, 'Ganho da base sem qualificação comprovada antes do ganho registrado. Permanece nos ganhos e no faturamento; não entra no numerador da taxa de fechamento.');
  for (const deal of outsideEntryWonDeals) diagnose(deal.id, 'Ganho do período fora da base de entradas selecionada. Permanece no total e no faturamento, sem ampliar a base ou suas taxas.');
  const diagnosticById = new Map([...input.diagnosticsDeals, ...wonDeals].map(deal => [deal.id, deal]));
  const diagnosticsDeals = [...diagnosticReasonsByDeal.keys()].flatMap(id => diagnosticById.has(id) ? [diagnosticById.get(id)!] : []);

  const ranks = new Map(input.entryFunnel.stages.map((stage, position) => [stage.stageId, position]));
  const stageName = (id: string) => board.stages.find(stage => stage.id === id)?.label || 'Etapa atual';
  const stageData: EntryFunnelStage[] = input.entryFunnel.stages.map(stage => {
    if (stage.milestone !== 'customer' && stage.role !== 'postcustomer') return { ...stage };
    const deals = stage.milestone === 'customer' ? wonDeals : wonDeals.filter(deal =>
      (ranks.get(deal.status) ?? -1) >= (ranks.get(stage.stageId) ?? Number.POSITIVE_INFINITY));
    const evidenceByDeal = new Map<string, EntryFunnelEvidence>(deals.map(deal => [deal.id, stage.milestone === 'customer'
      ? { kind: 'win', date: deal.closedAt!, stageName: 'Ganho registrado', observedAtStage: false }
      : { kind: 'current-stage', date: '', stageName: stageName(deal.status), observedAtStage: false }]));
    return { ...stage, deals, count: deals.length, evidenceByDeal,
      milestoneLabel: stage.milestone === 'customer' ? 'Ganhos do período' : 'Pós-venda atual',
      populationLabel: stage.milestone === 'customer'
        ? `Ganhos mantidos no período: ${entryWonDeals.length} da base de entradas e ${outsideEntryWonDeals.length} fora da base. Os ganhos fora da base não ampliam as entradas ou suas taxas.`
        : 'Pós-venda atual dos ganhos do período. A posição atual não comprova a data da chegada.' };
  });
  // Period gains need not be a subset of the preceding entry-stage population.
  // The intersection states how many of that column also appear in the next.
  for (let position = 0; position < stageData.length - 1; position++) {
    const current = stageData[position];
    const next = stageData[position + 1];
    const nextIds = new Set(next.deals.map(deal => deal.id));
    const intersection = current.deals.filter(deal => nextIds.has(deal.id)).length;
    current.conversionRate = rate(intersection, current.count);
    current.conversionLabel = 'leads que também avançaram à etapa seguinte';
    current.comparisonBase = current.count ? `${intersection} também em ${next.name} ÷ ${current.count} em ${current.name}` : '';
  }
  return {
    outcomePolicy: 'current_retained' as const, usesCustomerPromotion: false, workedDeals: entries,
    wonDeals, entryWonDeals, outsideEntryWonDeals, cohortWonDeals, unqualifiedWonDeals,
    closingRate: input.hasQualifiedStage ? rate(cohortWonDeals.length, qualifiedDeals.length) : null,
    totalConversionRate: rate(entryWonDeals.length, entries.length), qualificationEvidenceByDeal, leadQualificationDates,
    diagnosticReasonsByDeal, diagnosticsDeals, stageData, entryFunnel: { ...input.entryFunnel, stages: stageData },
  };
}
