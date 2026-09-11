import type { Board, Deal } from '@/types';

export interface StageEvent {
  dealId: string;
  stageId: string;
  date: string;
  fromStageId?: string;
  boardId?: string;
}
export interface MovementActivity {
  deal_id: string | null;
  title: string;
  date: string;
}
export interface PeriodRange { start: Date; end: Date }

const normalize = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Legacy activity titles are usable only when they map to one unambiguous stage. */
export function activityEvents(activities: MovementActivity[], board: Board): StageEvent[] {
  return activities.flatMap(activity => {
    if (!activity.deal_id || !activity.title.startsWith('Moveu para ')) return [];
    const label = normalize(activity.title.slice('Moveu para '.length));
    const matches = board.stages.filter(stage => normalize(stage.label) === label);
    return matches.length === 1
      ? [{ dealId: activity.deal_id, stageId: matches[0].id, date: activity.date }]
      : [];
  });
}

const STAGE_COLORS: Record<string, string> = {
  'bg-blue-500': '#3b82f6', 'bg-green-500': '#22c55e', 'bg-yellow-500': '#eab308',
  'bg-orange-500': '#f97316', 'bg-red-500': '#ef4444', 'bg-purple-500': '#a855f7',
  'bg-pink-500': '#ec4899', 'bg-indigo-500': '#6366f1', 'bg-teal-500': '#14b8a6', 'bg-slate-500': '#64748b',
};
export function getStageRules(board: Board) {
  const customers = board.stages.filter(stage => stage.linkedLifecycleStage === 'CUSTOMER');
  const won = (id: string) => {
    if (board.wonStageId) return id === board.wonStageId;
    const stage = board.stages.find(s => s.id === id);
    return !!stage && (/^(ganh|won|vendid|protocolad|concluid|novo cliente)|assinad/.test(normalize(stage.label)) ||
      (customers.length === 1 && customers[0].id === id));
  };
  const lost = (id: string) => {
    if (board.lostStageId && id === board.lostStageId) return true;
    const stage = board.stages.find(s => s.id === id);
    return !!stage && (stage.linkedLifecycleStage === 'OTHER' || /^(perdid|lost|desqualificad)/.test(normalize(stage.label)));
  };
  const steps = board.stages.filter(stage => !won(stage.id) && !lost(stage.id));
  const sqlIndex = steps.findIndex(stage => stage.linkedLifecycleStage === 'SALES_QUALIFIED');
  const qualifiedIndex = sqlIndex >= 0 ? sqlIndex : steps.findIndex(stage => /^qualificad/.test(normalize(stage.label)));
  return { won, lost, steps, qualifiedIndex };
}

export function performanceComparisonRange(range: PeriodRange, period: string): PeriodRange | undefined {
  if (period === 'all') return undefined;
  const months = period.includes('month') && !period.includes('days') ? 1 : period.includes('quarter') ? 3 : period.includes('year') ? 12 : 0;
  const end = new Date(range.start.getTime() - 1);
  const start = months ? new Date(range.start.getFullYear(), range.start.getMonth() - months, 1) : new Date(range.start.getTime() - (range.end.getTime() - range.start.getTime() + 1));
  return { start, end };
}

export function calculatePerformance(deals: Deal[], events: StageEvent[], board: Board, range: PeriodRange, ownerId = '', comparisonRange?: PeriodRange, snapshotDate = new Date()) {
  const scoped = deals.filter(deal => deal.boardId === board.id && (!ownerId || deal.ownerId === ownerId));
  const byId = new Map(scoped.map(deal => [deal.id, deal]));
  const inPeriod = (date?: string) => {
    const time = date ? Date.parse(date) : NaN;
    return Number.isFinite(time) && time >= range.start.getTime() && time <= range.end.getTime();
  };
  const rules = getStageRules(board);
  const stepIndex = (id?: string) => rules.steps.findIndex(stage => stage.id === id);
  const qualifiedStage = rules.steps[rules.qualifiedIndex]?.id;
  const qualified = new Set<string>();
  const qualificationKnown = new Set<string>();
  const qualificationDates = new Map<string, string>();
  const leadQualificationDates = new Map<string, string>();
  const estimatedQualificationIds = new Set<string>();
  const validEvents = events.filter(event => byId.has(event.dealId) && (!event.boardId || event.boardId === board.id) &&
    Number.isFinite(Date.parse(event.date)) && Date.parse(event.date) <= snapshotDate.getTime() &&
    Date.parse(event.date) >= Date.parse(byId.get(event.dealId)!.createdAt))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  for (const deal of scoped) {
    const persisted = deal.qualifiedAt;
    if (persisted && Number.isFinite(Date.parse(persisted)) && Date.parse(persisted) <= snapshotDate.getTime()) {
      leadQualificationDates.set(deal.id, persisted);
      if (deal.qualificationDateSource === 'estimated') estimatedQualificationIds.add(deal.id);
    }
  }
  // A direct arrival after SQL also proves qualification by that date.
  // Without a known origin below SQL, its exact first date is estimated.
  for (const event of validEvents) {
    if (rules.qualifiedIndex < 0 || rules.lost(event.stageId)) continue;
    if (stepIndex(event.stageId) < rules.qualifiedIndex && !rules.won(event.stageId)) continue;
    if (leadQualificationDates.has(event.dealId)) continue;
    leadQualificationDates.set(event.dealId, event.date);
    const origin = stepIndex(event.fromStageId);
    if (event.stageId !== qualifiedStage && !(origin >= 0 && origin < rules.qualifiedIndex)) {
      estimatedQualificationIds.add(event.dealId);
    }
  }
  for (const [id, date] of leadQualificationDates) {
    qualificationKnown.add(id);
    // Estimates are visible but must not manufacture a monthly conversion.
    if (inPeriod(date) && !estimatedQualificationIds.has(id)) {
      qualified.add(id);
      qualificationDates.set(id, date);
    }
  }

  const entries = scoped.filter(deal => inPeriod(deal.createdAt));
  // A creation is an entry, not proof of visits to all intermediate stages.
  const wonDeals = scoped.filter(deal => deal.isWon && !deal.isLost && inPeriod(deal.closedAt));
  const lostDeals = scoped.filter(deal => deal.isLost && !deal.isWon && inPeriod(deal.closedAt));
  const unknownClosure = scoped.filter(deal => (deal.isWon || deal.isLost) && !Number.isFinite(Date.parse(deal.closedAt || '')));
  const cycles = wonDeals.map(deal => (Date.parse(deal.closedAt!) - Date.parse(deal.createdAt)) / 86400000)
    .filter(days => Number.isFinite(days) && days >= 0);
  const wonRevenue = wonDeals.reduce((sum, deal) => sum + deal.value, 0);
  const previousRevenue = comparisonRange ? scoped.filter(deal => deal.isWon && !deal.isLost &&
    Date.parse(deal.closedAt || '') >= comparisonRange.start.getTime() && Date.parse(deal.closedAt || '') <= comparisonRange.end.getTime())
    .reduce((sum, deal) => sum + deal.value, 0) : null;
  const revenueChange = previousRevenue !== null && previousRevenue > 0 ? (wonRevenue - previousRevenue) / previousRevenue * 100 : null;
  const rate = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator * 100 : null;
  const chartStages = board.stages.filter(stage => !rules.lost(stage.id));
  const chartIndex = (id?: string) => chartStages.findIndex(stage => stage.id === id);
  const unknownQualification = rules.qualifiedIndex < 0 ? [] : scoped.filter(deal =>
    Date.parse(deal.createdAt) <= range.end.getTime() && !qualificationKnown.has(deal.id) &&
    (deal.lossCategory === 'qualified' || deal.isWon || stepIndex(deal.status) >= rules.qualifiedIndex));
  // The chart follows the creation cohort only up to its CURRENT stage.
  // Only the won column uses the selected closure period (including older leads).
  const cohortReached = new Map(chartStages.map(stage => [stage.id, new Set<string>()]));
  for (const deal of entries) {
    let furthest = Math.max(0, chartIndex(deal.status));
    if (deal.isWon && !deal.isLost) furthest = Math.max(furthest, chartStages.findIndex(stage => rules.won(stage.id)));
    // Loss is a separate outcome; historical advanced stages cannot resurrect it.
    if (deal.isLost) furthest = deal.lossCategory === 'qualified' ? Math.max(0, chartIndex(qualifiedStage)) : 0;
    for (let index = 0; index <= furthest; index++) cohortReached.get(chartStages[index]?.id)?.add(deal.id);
  }
  const stageCount = (id: string) => rules.won(id) ? wonDeals.length : cohortReached.get(id)?.size || 0;
  const stageData = chartStages.map((stage, index) => {
    const isWon = rules.won(stage.id);
    const next = chartStages[index + 1];
    const numerator = isWon ? wonDeals.length : next ? stageCount(next.id) : 0;
    const denominator = isWon ? entries.length : stageCount(stage.id);
    return {
      stageId: stage.id,
      deals: isWon ? wonDeals : entries.filter(deal => cohortReached.get(stage.id)?.has(deal.id)),
      name: stage.label, count: stageCount(stage.id),
      fill: STAGE_COLORS[stage.color] || (/^#[0-9a-f]{6}$/i.test(stage.color || '') ? stage.color : isWon ? '#22c55e' : '#3b82f6'),
      conversionRate: rate(numerator, denominator),
      conversionLabel: isWon ? 'ganhos encerrados / leads criados no período' : 'próxima etapa / esta etapa',
      populationLabel: isWon ? 'Ganhos pela data de encerramento; inclui leads de outros meses.' : 'Leads criados no período, até a etapa atual; retornos removem as etapas posteriores.',
      comparisonBase: isWon ? numerator + ' ganhos ÷ ' + denominator + ' entradas' : numerator + ' em ' + (next?.label || 'próxima etapa') + ' ÷ ' + denominator + ' em ' + stage.label,
    };
  });
  return {
    entries, estimatedQualificationIds, qualifiedIds: qualified, qualificationDates, leadQualificationDates, qualifiedCount: qualified.size,
    qualificationRate: rules.qualifiedIndex >= 0 ? rate(qualified.size, entries.length) : null,
    closingRate: rules.qualifiedIndex >= 0 ? rate(wonDeals.length, qualified.size) : null,
    hasQualifiedStage: rules.qualifiedIndex >= 0,
    wonDeals, lostDeals, unknownQualification, unknownClosure,
    wonRevenue, previousRevenue, revenueChange,
    fastestSalesCycle: cycles.length ? Math.round(Math.min(...cycles)) : null,
    slowestSalesCycle: cycles.length ? Math.round(Math.max(...cycles)) : null,
    avgSalesCycle: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    stageData,
  };
}

export type PerformanceMetrics = ReturnType<typeof calculatePerformance>;
