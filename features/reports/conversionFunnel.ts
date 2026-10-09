import type { Deal } from '@/types';
import { compareHistoricalDates, type LifecycleEvent, type LifecycleEventType } from './performanceHistory';
import type { EntryFunnel, EntryFunnelEvidence, EntryFunnelStage } from './entryFunnel';

interface Timed { date: string; recordedAt?: string }
interface Visit extends Timed { dealId: string; boardId?: string; stageId: string; fromStageId?: string }
interface Rules {
  boardId: string; stageIds: readonly string[]; qualifiedStageId?: string; customerStageId?: string;
  usesCustomerPromotion: boolean;
  lost: (stageId: string) => boolean;
}
interface ConversionInput extends Rules {
  entryEvents: readonly LifecycleEvent[]; events: readonly LifecycleEvent[];
  visits: readonly Visit[]; cutoffDate: string;
}
export const compareConversionEvents = (a: Timed, b: Timed) => compareHistoricalDates(a.date, b.date) ||
  (a.recordedAt && b.recordedAt ? compareHistoricalDates(a.recordedAt, b.recordedAt) : 0);
const firstPerDeal = (events: readonly LifecycleEvent[]) => {
  const result = new Map<string, LifecycleEvent>();
  for (const event of [...events].sort(compareConversionEvents)) if (!result.has(event.dealId)) result.set(event.dealId, event);
  return result;
};
const visitKey = (visit: Visit) => `${visit.dealId}:${visit.stageId}:${Date.parse(visit.date)}:${
  (visit.date.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0').slice(0, 9)}`;
export function selectConversionPopulation(input: ConversionInput) {
  const { boardId, stageIds, qualifiedStageId, customerStageId, usesCustomerPromotion, lost, cutoffDate } = input;
  const stageIndex = (id?: string) => id ? stageIds.indexOf(id) : -1;
  const qIndex = stageIndex(qualifiedStageId);
  const customerIndex = stageIndex(customerStageId);
  const withinCutoff = (date: string) => Number.isFinite(Date.parse(date)) && compareHistoricalDates(date, cutoffDate) <= 0;
  const events = input.events.filter(event => event.boardId === boardId && withinCutoff(event.date));
  const anchors = firstPerDeal(input.entryEvents.filter(event => event.boardId === boardId && event.type === 'entered_board' && withinCutoff(event.date)));
  const afterEntry = (event: Timed & { dealId: string }) => {
    const anchor = anchors.get(event.dealId);
    return !!anchor && withinCutoff(event.date) && compareConversionEvents(event, anchor) >= 0;
  };
  const ledgerVisits: Visit[] = events.flatMap(event => event.stageId && (event.type === 'entered_board' || event.type === 'stage_changed')
    ? [{ dealId: event.dealId, boardId, stageId: event.stageId, date: event.date, recordedAt: event.recordedAt }] : []);
  const recordedKeys = new Set(ledgerVisits.map(visitKey));
  const visits = [...ledgerVisits, ...input.visits.filter(visit => visit.boardId === boardId && withinCutoff(visit.date) && !recordedKeys.has(visitKey(visit)))]
    .sort(compareConversionEvents);
  const anchoredVisits = visits.filter(afterEntry);
  const qualifies = (stageId: string) => qIndex >= 0 && stageIndex(stageId) >= qIndex && !lost(stageId);
  const diagnostics = new Map<string, string[]>();
  const diagnosticEvents = new Map<string, LifecycleEvent>();
  const diagnose = (id: string, reason: string, event?: LifecycleEvent) => {
    const reasons = diagnostics.get(id) || [];
    if (!reasons.includes(reason)) reasons.push(reason);
    diagnostics.set(id, reasons);
    if (event) diagnosticEvents.set(id, event);
  };
  const qCandidates = events.filter(event => event.type === 'qualified');
  // An old trigger dated qualification when an unqualified lead was marked as
  // a qualified loss. Reject only this contradicted imported date. Other
  // historical/null-stage qualifications remain valid; no database row changes.
  const contradictedImport = (event: LifecycleEvent) => event.source === 'history' && event.snapshotSource === 'current' && !event.stageId &&
    input.visits.some(visit => visit.boardId === boardId && visit.dealId === event.dealId && lost(visit.stageId) &&
      stageIndex(visit.fromStageId) >= 0 && stageIndex(visit.fromStageId) < qIndex && compareHistoricalDates(visit.date, event.date) === 0);
  const excludedQualifications = qCandidates.filter(event => contradictedImport(event) &&
    !qCandidates.some(other => other.dealId === event.dealId && other.id !== event.id && !contradictedImport(other) && compareHistoricalDates(other.date, event.date) <= 0) &&
    !visits.some(visit => visit.dealId === event.dealId && qualifies(visit.stageId) && compareHistoricalDates(visit.date, event.date) <= 0));
  const excludedIds = new Set(excludedQualifications.map(event => event.id));
  const validQualifications = qCandidates.filter(event => !excludedIds.has(event.id));
  // The imported row may have prevented the legacy fallback from recording a
  // genuine later crossing. Recover that observed date, never the earlier loss.
  for (const excluded of excludedQualifications) {
    const proof = input.visits.filter(visit => visit.boardId === boardId && visit.dealId === excluded.dealId && withinCutoff(visit.date) &&
      compareHistoricalDates(visit.date, excluded.date) > 0 && qualifies(visit.stageId) &&
      ((!visit.fromStageId && visit.stageId === qualifiedStageId) ||
        (stageIndex(visit.fromStageId) >= 0 && !qualifies(visit.fromStageId!))))
      .sort(compareConversionEvents)[0];
    if (!proof || validQualifications.some(event => event.dealId === proof.dealId && compareHistoricalDates(event.date, proof.date) <= 0)) continue;
    const exact = events.find(event => event.dealId === proof.dealId && event.stageId === proof.stageId && compareHistoricalDates(event.date, proof.date) === 0);
    validQualifications.push({ ...(exact || excluded), id: `conversion:qualified:${proof.dealId}:${proof.date}`, type: 'qualified',
      date: proof.date, recordedAt: exact?.recordedAt, stageId: proof.stageId, source: exact?.source || 'history',
      snapshotSource: exact?.snapshotSource || 'current', isWon: false, isLost: false });
  }
  const qualifications = new Map<string, LifecycleEvent>();
  const qualificationConfirmedAt = new Map<string, Timed>();
  const qualificationCarryInIds = new Set<string>();
  for (const [id, anchor] of anchors) {
    const candidates = validQualifications.filter(event => event.dealId === id).sort(compareConversionEvents);
    const current = candidates.find(event => compareConversionEvents(event, anchor) >= 0);
    const previous = candidates.find(event => compareConversionEvents(event, anchor) < 0);
    const confirmation = previous ? anchoredVisits.find(visit => visit.dealId === id && qualifies(visit.stageId)) : undefined;
    if (previous && confirmation && (!current || compareConversionEvents(confirmation, current) <= 0)) {
      qualifications.set(id, previous);
      qualificationConfirmedAt.set(id, confirmation);
      qualificationCarryInIds.add(id);
    } else if (current) {
      qualifications.set(id, current);
      qualificationConfirmedAt.set(id, current);
    }
  }
  for (const event of excludedQualifications) if (afterEntry(event)) diagnose(event.dealId,
    'Qualificação histórica contradita pela passagem direta de uma etapa anterior ao MQL para Perdido, sem outra prova de qualificação.', event);
  const allWins = events.filter(event => event.type === 'won' && afterEntry(event));
  const eligibleWins = allWins.filter(event => {
    const q = qualifications.get(event.dealId);
    const confirmed = qualificationConfirmedAt.get(event.dealId);
    return !!q && !!confirmed && compareHistoricalDates(q.date, event.date) <= 0 && compareHistoricalDates(confirmed.date, event.date) <= 0;
  });
  const wins = firstPerDeal(eligibleWins);
  const unqualifiedWins = firstPerDeal(allWins.filter(event => !wins.has(event.dealId)));
  for (const event of unqualifiedWins.values()) diagnose(event.dealId,
    'Ganho registrado sem qualificação comprovada antes da conversão nesta jornada; fica fora da taxa e do faturamento convertido.', event);

  // A later operational visit is valid only while its eligible CUSTOMER
  // episode is active. Old conversion evidence cannot authorize a protocol
  // reached after an explicit reopening, loss, transfer or pre-customer return.
  const eligibleWinIds = new Set(eligibleWins.map(event => event.id));
  const timeline: { timed: Timed; dealId: string; reset?: boolean; win?: LifecycleEvent; visit?: Visit }[] = [];
  for (const event of events.filter(afterEntry)) {
    if (event.type === 'lost' || event.type === 'reopened' || event.type === 'left_board') timeline.push({ timed: event, dealId: event.dealId, reset: true });
    else if (event.type === 'won') timeline.push({ timed: event, dealId: event.dealId, win: event });
  }
  for (const visit of anchoredVisits) timeline.push({ timed: visit, dealId: visit.dealId, visit,
    reset: lost(visit.stageId) || (customerIndex >= 0 && stageIndex(visit.stageId) >= 0 && stageIndex(visit.stageId) < customerIndex) });
  timeline.sort((a, b) => compareConversionEvents(a.timed, b.timed) || Number(!!b.reset) - Number(!!a.reset) || Number(!!b.win) - Number(!!a.win));
  const activeWins = new Map<string, LifecycleEvent>();
  const postCustomerVisits: Visit[] = [];
  for (const item of timeline) {
    if (item.reset) activeWins.delete(item.dealId);
    if (item.win) {
      if (eligibleWinIds.has(item.win.id)) activeWins.set(item.dealId, item.win);
      else activeWins.delete(item.dealId);
    }
    if (item.visit && customerIndex >= 0 && stageIndex(item.visit.stageId) > customerIndex && !lost(item.visit.stageId)) {
      if (activeWins.has(item.dealId)) postCustomerVisits.push(item.visit);
      else {
        const exact = events.find(event => event.dealId === item.dealId && event.stageId === item.visit!.stageId &&
          compareHistoricalDates(event.date, item.visit!.date) === 0 && (event.type === 'stage_changed' || event.type === 'entered_board'));
        const snapshot = exact || anchors.get(item.dealId)!;
        diagnose(item.dealId, usesCustomerPromotion
          ? 'Etapa posterior a Cliente registrada sem ganho elegível comprovado no mesmo episódio; não conta como Cliente ou pós-venda convertido.'
          : 'Etapa posterior ao ganho registrada sem encerramento elegível comprovado no mesmo episódio; não conta como ganho ou avanço após encerramento.',
          { ...snapshot, type: 'stage_changed', stageId: item.visit.stageId, date: item.visit.date, recordedAt: item.visit.recordedAt,
            snapshotSource: exact?.snapshotSource || 'current', isWon: false, isLost: false });
      }
    }
  }
  const selected: Partial<Record<LifecycleEventType, LifecycleEvent[]>> = {
    entered_board: [...anchors.values()], qualified: [...qualifications.values()], won: [...wins.values()],
    lost: events.filter(event => event.type === 'lost' && afterEntry(event)),
    reopened: events.filter(event => event.type === 'reopened' && afterEntry(event)),
  };
  const unknownStageIds = new Set([...anchors.keys()].filter(id => !qualifications.has(id) && !wins.has(id) &&
    !anchoredVisits.some(visit => visit.dealId === id && stageIndex(visit.stageId) >= 0 && !lost(visit.stageId))));
  for (const id of unknownStageIds) diagnose(id, 'Entrada sem etapa válida comprovada: permanece no denominador, mas não cria passagem por uma etapa do funil.');
  return { anchors, qualifications, qualificationConfirmedAt, qualificationCarryInIds, wins,
    unqualifiedWins, excludedQualifications: excludedQualifications.filter(afterEntry),
    visits: anchoredVisits, postCustomerVisits, selected, diagnostics, diagnosticEvents, unknownStageIds, qualifiedStageId, customerStageId, usesCustomerPromotion };
}
export type ConversionPopulation = ReturnType<typeof selectConversionPopulation>;

/** All columns share the entry population and the configured stage order.
 * Business milestones are exact canonical ID sets. Positional jumps can fill
 * intermediate progress, but never create qualification or Customer evidence.
 */
export function buildConversionFunnel(population: ConversionPopulation, entries: Deal[], qualifiedDeals: Deal[], wonDeals: Deal[],
  stages: readonly Pick<EntryFunnelStage, 'stageId' | 'name' | 'fill'>[]): EntryFunnel {
  const base = new Map(entries.map(deal => [deal.id, deal]));
  const ranks = new Map(stages.map((stage, index) => [stage.stageId, index]));
  const qIndex = ranks.get(population.qualifiedStageId || '') ?? -1;
  const customerIndex = ranks.get(population.customerStageId || '') ?? -1;
  const stageName = (id: string) => stages[ranks.get(id) ?? -1]?.name || 'Etapa registrada';
  const milestoneEvidence = (kind: 'qualification' | 'customer', event: LifecycleEvent): EntryFunnelEvidence => ({
    kind: kind === 'customer' && !population.usesCustomerPromotion ? 'win' : kind,
    date: event.date, stageName: kind === 'qualification' ? 'Qualificação registrada' : population.usesCustomerPromotion ? 'Promoção a Cliente registrada' : 'Ganho registrado', observedAtStage: false,
  });
  const unknownStageCount = population.unknownStageIds.size;
  const result: EntryFunnelStage[] = stages.map((stage, index) => {
    const milestone = index === qIndex ? 'qualification' : index === customerIndex ? 'customer' : undefined;
    const postCustomer = customerIndex >= 0 && index > customerIndex;
    const deals: Deal[] = [];
    const evidenceByDeal = new Map<string, EntryFunnelEvidence>();
    if (milestone) {
      for (const deal of milestone === 'qualification' ? qualifiedDeals : wonDeals) {
        deals.push(deal);
        evidenceByDeal.set(deal.id, milestoneEvidence(milestone, (milestone === 'qualification' ? population.qualifications : population.wins).get(deal.id)!));
      }
    } else for (const [id, deal] of base) {
      const q = population.qualifications.get(id);
      const win = population.wins.get(id);
      if (postCustomer && !win || qIndex >= 0 && index > qIndex && !q) continue;
      const confirmation = population.qualificationConfirmedAt.get(id);
      const visits = (postCustomer ? population.postCustomerVisits : population.visits).filter(visit => visit.dealId === id &&
        (ranks.get(visit.stageId) ?? -1) >= index &&
        (!(qIndex >= 0 && index > qIndex) || !confirmation || compareConversionEvents(visit, confirmation) >= 0));
      const direct = visits.find(visit => visit.stageId === stage.stageId);
      const later = [...visits].sort((a, b) => (ranks.get(b.stageId) ?? -1) - (ranks.get(a.stageId) ?? -1) || compareConversionEvents(a, b))[0];
      const visit = direct || later;
      let evidence: EntryFunnelEvidence | undefined;
      if (visit) evidence = { kind: 'stage', stageName: stageName(visit.stageId), date: visit.date, observedAtStage: !!direct };
      else if (!postCustomer && win && customerIndex >= 0 && index < customerIndex) evidence = milestoneEvidence('customer', win);
      else if (q && qIndex >= 0 && index < qIndex) evidence = milestoneEvidence('qualification', q);
      if (!evidence) continue;
      deals.push(deal);
      evidenceByDeal.set(id, evidence);
    }
    return { ...stage, deals, count: deals.length, evidenceByDeal, countingMethod: 'reached_or_beyond', milestone,
      milestoneLabel: milestone === 'qualification' ? 'Qualificado' : milestone === 'customer' ? population.usesCustomerPromotion ? 'Cliente · Ganhos' : 'Ganhos' : undefined,
      role: postCustomer ? 'postcustomer' : undefined, conversionRate: null, conversionLabel: '', comparisonBase: '',
      populationLabel: milestone === 'qualification' ? 'Mesmos leads qualificados do indicador, com prova válida nesta base de entradas.' :
        milestone === 'customer' ? population.usesCustomerPromotion
          ? 'Mesmos ganhos entre qualificados do indicador, com promoção a Cliente comprovada.'
          : 'Mesmos ganhos entre qualificados do indicador, com encerramento explícito comprovado.' :
          postCustomer ? population.usesCustomerPromotion
            ? 'Leads convertidos com avanço registrado nesta etapa ou além durante um episódio de Cliente válido.'
            : 'Leads com avanço registrado nesta etapa ou além durante um episódio de ganho comprovado.' :
            `Avanço acumulado dos leads da base, limitado pelos marcos de qualificação e ${population.usesCustomerPromotion ? 'Cliente' : 'ganho'} comprovados. Não comprova passagem por etapas puladas.` };
  });
  // A percentage belongs to the CURRENT column and uses the NEXT column as
  // numerator. The final column and an empty denominator never display a rate.
  for (let index = 0; index < result.length - 1; index++) {
    const current = result[index];
    const next = result[index + 1];
    if (!current.count) continue;
    current.conversionRate = next.count / current.count * 100;
    current.conversionLabel = 'avançaram para a próxima etapa';
    current.comparisonBase = `${next.count} em ${next.name} ÷ ${current.count} em ${current.name}`;
  }
  return { stages: result, baseCount: base.size, unknownStageCount };
}
