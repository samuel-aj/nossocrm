import type { Board, Deal } from '@/types';
import { dealAtEvent, matchesReportFilters, type LifecycleEvent, type PerformanceMode } from './performanceHistory';
export type { LifecycleEvent, PerformanceMode } from './performanceHistory';

export interface StageEvent { dealId: string; stageId: string; date: string; fromStageId?: string; boardId?: string }
export interface MovementActivity { deal_id: string | null; title: string; date: string; board_id?: string }
export interface PeriodRange { start: Date; end: Date }
export interface PerformanceOptions { mode?: PerformanceMode; lifecycleEvents?: LifecycleEvent[]; productId?: string }
const normalize = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const time = (date?: string) => Date.parse(date || '');
const rate = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator * 100 : null;
const distinct = (deals: Deal[]) => [...new Map(deals.map(deal => [deal.id, deal])).values()];

/** A title alone does not establish which board the activity belonged to. */
export function activityEvents(activities: MovementActivity[], board: Board): StageEvent[] {
  return activities.flatMap(activity => {
    if (activity.board_id !== board.id || !activity.deal_id || !activity.title.startsWith('Moveu para ')) return [];
    const matches = board.stages.filter(stage => normalize(stage.label) === normalize(activity.title.slice('Moveu para '.length)));
    return matches.length === 1 ? [{ dealId: activity.deal_id, stageId: matches[0].id, date: activity.date, boardId: board.id }] : [];
  });
}
const STAGE_COLORS: Record<string, string> = {
  'bg-blue-500': '#3b82f6', 'bg-green-500': '#22c55e', 'bg-yellow-500': '#eab308',
  'bg-orange-500': '#f97316', 'bg-red-500': '#ef4444', 'bg-purple-500': '#a855f7',
  'bg-pink-500': '#ec4899', 'bg-indigo-500': '#6366f1', 'bg-teal-500': '#14b8a6', 'bg-slate-500': '#64748b',
};
export function getStageRules(board: Board) {
  const won = (id: string) => {
    if (board.wonStageId) return id === board.wonStageId;
    const stage = board.stages.find(s => s.id === id);
    return !!stage && board.linkedLifecycleStage !== 'CUSTOMER' && stage.linkedLifecycleStage === 'CUSTOMER';
  };
  const lost = (id: string) => {
    if (board.lostStageId) return id === board.lostStageId;
    const stage = board.stages.find(s => s.id === id);
    return !!stage && stage.linkedLifecycleStage === 'OTHER';
  };
  // Keep the configured order, including outcome stages, just like the DB rule.
  const steps = board.stages;
  const mql = steps.findIndex(stage => stage.linkedLifecycleStage === 'MQL');
  const sql = steps.findIndex(stage => stage.linkedLifecycleStage === 'SALES_QUALIFIED');
  const qualifiedIndex = mql >= 0 ? mql : sql >= 0 ? sql : steps.findIndex(stage => /^qualificad/.test(normalize(stage.label)));
  return { won, lost, steps, qualifiedIndex };
}

/** Calendar periods compare equal elapsed portions, capped at the previous period's end. */
export function performanceComparisonRange(range: PeriodRange, period: string): PeriodRange | undefined {
  if (period === 'all') return undefined;
  const months = period.includes('month') && !period.includes('days') ? 1 : period.includes('quarter') ? 3 : period.includes('year') ? 12 : 0;
  const previousEnd = new Date(range.start.getTime() - 1);
  const duration = range.end.getTime() - range.start.getTime();
  if (!months) return { start: new Date(range.start.getTime() - duration - 1), end: previousEnd };
  const start = new Date(range.start.getFullYear(), range.start.getMonth() - months, 1);
  const fullEnd = new Date(range.start.getFullYear(), range.start.getMonth() + months, 1).getTime() - 1;
  const end = range.end.getTime() >= fullEnd ? previousEnd : new Date(Math.min(previousEnd.getTime(), start.getTime() + duration));
  return { start, end };
}

export function calculatePerformance(deals: Deal[], events: StageEvent[], board: Board, range: PeriodRange, ownerId = '', comparisonRange?: PeriodRange, snapshotDate = new Date(), options: PerformanceOptions = {}) {
  const mode = options.mode || 'cohort';
  const productId = options.productId || '';
  const cutoff = Math.min(range.end.getTime(), snapshotDate.getTime());
  const rules = getStageRules(board);
  const qualifiedStage = rules.steps[rules.qualifiedIndex]?.id;
  const stepIndex = (id?: string) => rules.steps.findIndex(stage => stage.id === id);
  const byId = new Map(deals.map(deal => [deal.id, deal]));
  const validDate = (date: string, created: string) => Number.isFinite(time(date)) && time(date) >= time(created) && time(date) <= cutoff;
  const inPeriod = (date: string) => time(date) >= range.start.getTime() && time(date) <= cutoff;
  const filtered = (deal: Deal) => matchesReportFilters(deal, ownerId, productId);
  const boardLedger = (options.lifecycleEvents || []).filter(event => event.boardId === board.id && byId.has(event.dealId));
  const ledger = boardLedger.filter(event => validDate(event.date, event.dealCreatedAt))
    .sort((a, b) => time(a.date) - time(b.date) || a.id.localeCompare(b.id));
  const history = events.filter(event => event.boardId === board.id && byId.has(event.dealId) && validDate(event.date, byId.get(event.dealId)!.createdAt))
    .sort((a, b) => time(a.date) - time(b.date));
  const ledgerByDeal = new Map<string, LifecycleEvent[]>();
  for (const event of ledger) ledgerByDeal.set(event.dealId, [...(ledgerByDeal.get(event.dealId) || []), event]);
  const ledgerFor = (id: string) => ledgerByDeal.get(id) || [];
  const historical = (event: LifecycleEvent) => dealAtEvent(byId.get(event.dealId)!, event);
  const legacyIds = new Set<string>();
  const snapshotAt = (deal: Deal, date: string, stageId?: string): Deal => {
    const exact = ledgerFor(deal.id).find(event => time(event.date) === time(date) && (!stageId || event.stageId === stageId));
    const snapshot = exact || ledgerFor(deal.id).filter(event => time(event.date) <= time(date)).at(-1);
    if (!exact || exact.snapshotSource === 'current') legacyIds.add(deal.id);
    const value = snapshot ? historical(snapshot) : { ...deal, boardId: board.id, isWon: false, isLost: false, closedAt: undefined, qualifiedAt: undefined };
    return { ...value, status: stageId || value.status, updatedAt: date };
  };
  const canonical = [...ledger];
  const addLegacy = (deal: Deal, type: LifecycleEvent['type'], date: string, stageId?: string) => {
    if (!validDate(date, deal.createdAt) || canonical.some(event => event.dealId === deal.id && event.type === type && time(event.date) === time(date))) return;
    canonical.push({ id: `legacy:${deal.id}:${type}:${date}`, dealId: deal.id, boardId: board.id, type, date,
      source: 'history', snapshotSource: 'current', stageId, ownerId: deal.ownerId, owner: deal.owner,
      value: deal.value, title: deal.title, dealCreatedAt: deal.createdAt, items: deal.items,
      lossCategory: deal.lossCategory, lossReason: deal.lossReason, isWon: type === 'won', isLost: type === 'lost' });
  };
  for (const event of history) {
    const deal = byId.get(event.dealId)!;
    if (!event.fromStageId && time(event.date) === time(deal.createdAt) && !ledgerFor(deal.id).some(e => e.type === 'entered_board')) addLegacy(deal, 'entered_board', event.date, event.stageId);
    const origin = stepIndex(event.fromStageId);
    const destination = stepIndex(event.stageId);
    const originQualifies = origin >= rules.qualifiedIndex && !rules.lost(event.fromStageId || '');
    const destinationQualifies = destination >= rules.qualifiedIndex && !rules.lost(event.stageId);
    if (rules.qualifiedIndex >= 0 && ((event.stageId === qualifiedStage && !event.fromStageId) ||
      (origin >= 0 && !originQualifies && destinationQualifies))) {
      if (!ledgerFor(deal.id).some(e => e.type === 'qualified')) addLegacy(deal, 'qualified', event.date, event.stageId);
    }
    for (const type of ['won', 'lost'] as const) {
      if (rules[type](event.stageId) && !ledgerFor(deal.id).some(e => e.type === type)) addLegacy(deal, type, event.date, event.stageId);
    }
  }
  for (const deal of deals) {
    if (deal.boardId !== board.id || !validDate(deal.createdAt, deal.createdAt)) continue;
    const recorded = ledgerFor(deal.id);
    const hasLaterEntry = (date: string) => boardLedger.some(event => event.dealId === deal.id && event.type === 'entered_board' && time(event.date) > time(date));
    if (deal.qualifiedAt && (deal.qualificationDateSource === 'transition' || deal.qualificationDateSource === 'history') &&
      !recorded.some(event => event.type === 'qualified') &&
      !hasLaterEntry(deal.qualifiedAt)) addLegacy(deal, 'qualified', deal.qualifiedAt);
    const closure = deal.isWon !== deal.isLost ? deal.isWon ? 'won' : deal.isLost ? 'lost' : undefined : undefined;
    if (closure && deal.closedAt && !hasLaterEntry(deal.closedAt) && !boardLedger.some(event => event.dealId === deal.id && ['won', 'lost', 'reopened'].includes(event.type))) addLegacy(deal, closure, deal.closedAt, deal.status);
  }
  canonical.sort((a, b) => time(a.date) - time(b.date) || a.id.localeCompare(b.id));
  const first = (type: LifecycleEvent['type']) => {
    const result = new Map<string, LifecycleEvent>();
    for (const event of canonical) if (event.type === type && !result.has(event.dealId)) result.set(event.dealId, event);
    return result;
  };
  // A board-proven stage event also establishes membership, but not an invented entry date.
  const cohort = deals.flatMap(deal => {
    const entry = canonical.find(event => event.dealId === deal.id);
    const firstVisit = history.find(event => event.dealId === deal.id);
    const created = entry?.dealCreatedAt || deal.createdAt;
    if (!inPeriod(created) || (!entry && !firstVisit)) return [];
    const snapshot = firstVisit && (!entry || time(firstVisit.date) < time(entry.date))
      ? snapshotAt(deal, firstVisit.date, firstVisit.stageId) : historical(entry!);
    // Ownership is anchored to the first recorded board presence. Product
    // selection intentionally uses today's items: creation inserts items after
    // the deal row, so an immutable empty entry snapshot is not its product list.
    return matchesReportFilters({ ...snapshot, items: deal.items }, ownerId, productId) ? [snapshot] : [];
  });
  const cohortIds = new Set(cohort.map(deal => deal.id));
  const unknownBoardMembershipCount = mode === 'cohort' ? deals.filter(deal => deal.boardId === board.id && inPeriod(deal.createdAt) && filtered(deal) &&
    !canonical.some(event => event.dealId === deal.id) && !history.some(event => event.dealId === deal.id)).length : 0;
  const firstQualified = first('qualified');
  const leadQualificationDates = new Map([...firstQualified].map(([id, event]) => [id, event.date]));
  const select = (type: LifecycleEvent['type']) => {
    const candidates = type === 'qualified' ? [...firstQualified.values()] : canonical.filter(event => event.type === type);
    return candidates.filter(event => mode === 'cohort' ? cohortIds.has(event.dealId) : inPeriod(event.date) && filtered(historical(event)));
  };
  const selectedEvents = mode === 'current' ? [] : [...select('entered_board'), ...select('qualified'), ...select('won'), ...select('lost'), ...select('reopened')];
  for (const event of selectedEvents) if (event.snapshotSource === 'current') legacyIds.add(event.dealId);
  const currentDeals = deals.filter(deal => deal.boardId === board.id && !deal.isWon && !deal.isLost && filtered(deal));
  const currentValue = currentDeals.reduce((sum, deal) => sum + deal.value, 0);
  const entries = mode === 'cohort' ? cohort : mode === 'current' ? currentDeals : distinct(select('entered_board').map(historical));
  const qualifiedDeals = mode === 'current' ? [] : distinct(select('qualified').map(historical));
  const qualifiedIds = new Set(qualifiedDeals.map(deal => deal.id));
  const qualificationDates = new Map([...firstQualified].filter(([id]) => qualifiedIds.has(id)).map(([id, event]) => [id, event.date]));
  const wonDeals = mode === 'current' ? [] : distinct(select('won').map(historical));
  const lostDeals = mode === 'current' ? [] : distinct(select('lost').map(historical));
  const reopenedDeals = mode === 'current' ? [] : distinct(select('reopened').map(historical));
  const cohortWonDeals = wonDeals.filter(deal => qualifiedIds.has(deal.id) && time(qualificationDates.get(deal.id)) <= time(deal.closedAt));
  const coverageDeals = deals.filter(deal => (mode === 'cohort' ? cohortIds.has(deal.id) || (deal.boardId === board.id && inPeriod(deal.createdAt) && filtered(deal)) : deal.boardId === board.id && filtered(deal)) && time(deal.createdAt) <= cutoff);
  const estimatedQualificationIds = new Set(coverageDeals.filter(deal => deal.qualificationDateSource === 'estimated' && !firstQualified.has(deal.id)).map(deal => deal.id));
  const unknownQualification = rules.qualifiedIndex < 0 ? [] : coverageDeals.filter(deal => !firstQualified.has(deal.id) && !estimatedQualificationIds.has(deal.id) &&
    (deal.lossCategory === 'qualified' || deal.isWon || (!rules.lost(deal.status) && stepIndex(deal.status) >= rules.qualifiedIndex)) &&
    !(options.lifecycleEvents || []).some(event => event.dealId === deal.id && event.boardId === board.id && event.type === 'qualified' && time(event.date) > cutoff) &&
    !events.some(event => event.dealId === deal.id && event.boardId === board.id && event.stageId === qualifiedStage && time(event.date) > cutoff));
  const unknownClosure = coverageDeals.filter(deal => (deal.isWon || deal.isLost) && !Number.isFinite(time(deal.closedAt)) && !canonical.some(event => event.dealId === deal.id && (event.type === 'won' || event.type === 'lost')));
  const chartStages = mode === 'current' ? board.stages : board.stages.filter(stage => !rules.lost(stage.id));
  const populations = new Map(chartStages.map(stage => [stage.id, new Map<string, Deal>()]));
  if (mode === 'current') {
    for (const deal of currentDeals) populations.get(deal.status)?.set(deal.id, deal);
  } else {
    const arrivals = [...history, ...ledger.filter(event => event.stageId && (event.type === 'entered_board' || event.type === 'stage_changed')).map(event => ({
      dealId: event.dealId, boardId: event.boardId, stageId: event.stageId!, date: event.date,
    }))].sort((a, b) => time(a.date) - time(b.date));
    for (const event of arrivals) {
      const deal = snapshotAt(byId.get(event.dealId)!, event.date, event.stageId);
      if (mode === 'cohort' ? cohortIds.has(event.dealId) : inPeriod(event.date) && filtered(deal)) populations.get(event.stageId)?.set(event.dealId, deal);
    }
  }
  const stageData = chartStages.map((stage, index) => {
    const population = [...populations.get(stage.id)!.values()];
    const next = chartStages[index + 1];
    const nextIds = next ? populations.get(next.id)! : new Map<string, Deal>();
    const numerator = population.filter(deal => nextIds.has(deal.id)).length;
    return { stageId: stage.id, deals: population, name: stage.label, count: population.length,
      fill: STAGE_COLORS[stage.color] || (/^#[0-9a-f]{6}$/i.test(stage.color || '') ? stage.color : rules.won(stage.id) ? '#22c55e' : '#3b82f6'),
      conversionRate: mode === 'cohort' && next ? rate(numerator, population.length) : null,
      conversionLabel: 'desta etapa, também chegaram à próxima',
      populationLabel: mode === 'cohort' ? 'Leads da coorte com chegada registrada nesta etapa até o corte. Saltos não contam visitas intermediárias.' :
        mode === 'period' ? 'Leads distintos com chegada registrada nesta etapa no período.' : 'Leads abertos que estão nesta etapa agora.',
      comparisonBase: mode === 'cohort' && next && population.length > 0 ? `${numerator} também em ${next.label} ÷ ${population.length} em ${stage.label}` : '' };
  });
  const wonRevenue = wonDeals.reduce((sum, deal) => sum + deal.value, 0);
  const effectiveComparison = comparisonRange && (cutoff < range.end.getTime() ? { start: comparisonRange.start,
    end: new Date(Math.min(comparisonRange.end.getTime(), comparisonRange.start.getTime() + Math.max(0, cutoff - range.start.getTime()))) } : comparisonRange);
  const previousRevenue: number | null = effectiveComparison && mode !== 'current'
    ? calculatePerformance(deals, events, board, effectiveComparison, ownerId, undefined, snapshotDate, options).wonRevenue : null;
  const cycles = wonDeals.map(deal => (time(deal.closedAt) - time(deal.createdAt)) / 86400000).filter(days => Number.isFinite(days) && days >= 0);
  const reportedIds = new Set([...entries, ...qualifiedDeals, ...wonDeals, ...lostDeals, ...reopenedDeals, ...stageData.flatMap(stage => stage.deals)].map(deal => deal.id));
  return {
    mode, cutoffDate: new Date(cutoff).toISOString(), entries, qualifiedDeals, cohortWonDeals, currentDeals, currentValue, reopenedDeals,
    estimatedQualificationIds, qualifiedIds, qualificationDates, leadQualificationDates, qualifiedCount: qualifiedIds.size,
    qualificationRate: mode === 'cohort' && rules.qualifiedIndex >= 0 ? rate(qualifiedIds.size, entries.length) : null,
    closingRate: mode === 'cohort' && rules.qualifiedIndex >= 0 ? rate(cohortWonDeals.length, qualifiedIds.size) : null,
    hasQualifiedStage: rules.qualifiedIndex >= 0, wonDeals, lostDeals, unknownQualification, unknownClosure,
    coverage: { unknownQualificationCount: unknownQualification.length, estimatedQualificationCount: estimatedQualificationIds.size, unknownBoardMembershipCount,
      unknownClosureCount: unknownClosure.length, legacySnapshotCount: [...legacyIds].filter(id => reportedIds.has(id)).length },
    wonRevenue, previousRevenue, revenueChange: previousRevenue !== null && previousRevenue > 0 ? (wonRevenue - previousRevenue) / previousRevenue * 100 : null,
    fastestSalesCycle: cycles.length ? Math.round(Math.min(...cycles)) : null,
    slowestSalesCycle: cycles.length ? Math.round(Math.max(...cycles)) : null,
    avgSalesCycle: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    stageData,
  };
}
export type PerformanceMetrics = ReturnType<typeof calculatePerformance>;
