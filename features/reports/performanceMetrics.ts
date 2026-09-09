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
  const qualifiedIndex = steps.findIndex(stage => /^qualificad/.test(normalize(stage.label)) || stage.linkedLifecycleStage === 'SALES_QUALIFIED');
  return { won, lost, steps, qualifiedIndex };
}

export function calculatePerformance(deals: Deal[], events: StageEvent[], board: Board, range: PeriodRange, ownerId = '') {
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
  const reached = new Map(board.stages.map(stage => [stage.id, new Set<string>()]));
  const priorStages = new Map<string, string>();
  const seenEvents = new Set<string>();
  // Coverage uses all known history; only inPeriod events enter monthly metrics.
  const validEvents = events.filter(event => byId.has(event.dealId) && (!event.boardId || event.boardId === board.id) &&
    Number.isFinite(Date.parse(event.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || Number(!!b.fromStageId) - Number(!!a.fromStageId));

  for (const event of validEvents) {
    // Webhooks can emit one copy per endpoint; activities can describe the same move.
    const key = `${event.dealId}:${event.stageId}:${event.date}`;
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);
    const currentIndex = stepIndex(event.stageId);
    const previousId = event.fromStageId || priorStages.get(event.dealId);
    const previousIndex = stepIndex(previousId);
    if (previousId === event.stageId) continue;
    const crossedQualification = rules.qualifiedIndex >= 0 &&
      (event.stageId === qualifiedStage ||
        (previousIndex >= 0 && previousIndex < rules.qualifiedIndex && currentIndex >= rules.qualifiedIndex));
    if (crossedQualification) {
      qualificationKnown.add(event.dealId);
      if (inPeriod(event.date)) {
        qualified.add(event.dealId);
        if (qualifiedStage) reached.get(qualifiedStage)?.add(event.dealId);
        if (!qualificationDates.has(event.dealId)) qualificationDates.set(event.dealId, event.date);
      }
    }
    if (inPeriod(event.date)) reached.get(event.stageId)?.add(event.dealId);
    priorStages.set(event.dealId, event.stageId);
  }

  const entries = scoped.filter(deal => inPeriod(deal.createdAt));
  // A creation is an entry, not proof of visits to all intermediate stages.
  const wonDeals = scoped.filter(deal => deal.isWon && !deal.isLost && inPeriod(deal.closedAt));
  const lostDeals = scoped.filter(deal => deal.isLost && !deal.isWon && inPeriod(deal.closedAt));
  const unknownQualification = rules.qualifiedIndex < 0 ? [] : scoped.filter(deal =>
    Date.parse(deal.createdAt) <= range.end.getTime() && !qualificationKnown.has(deal.id) &&
    (deal.lossCategory === 'qualified' || deal.isWon || stepIndex(deal.status) >= rules.qualifiedIndex));
  const unknownClosure = scoped.filter(deal => (deal.isWon || deal.isLost) && !Number.isFinite(Date.parse(deal.closedAt || '')));
  const cycles = wonDeals.map(deal => (Date.parse(deal.closedAt!) - Date.parse(deal.createdAt)) / 86400000)
    .filter(days => Number.isFinite(days) && days >= 0);
  const rate = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator * 100 : null;
  const chartStages = board.stages.filter(stage => !rules.lost(stage.id));
  const stageCount = (id: string) => rules.won(id) ? wonDeals.length : reached.get(id)?.size || 0;
  const stageData = chartStages.map((stage, index) => {
    const isWon = rules.won(stage.id);
    const next = chartStages[index + 1];
    const numerator = isWon ? wonDeals.length : next ? stageCount(next.id) : 0;
    const denominator = isWon ? entries.length : stageCount(stage.id);
    return {
      name: stage.label, count: stageCount(stage.id),
      fill: STAGE_COLORS[stage.color] || (/^#[0-9a-f]{6}$/i.test(stage.color || '') ? stage.color : isWon ? '#22c55e' : '#3b82f6'),
      conversionRate: rate(numerator, denominator),
      conversionLabel: isWon ? 'ganhos / entradas no período' : 'volume da próxima etapa / esta etapa',
      comparisonBase: isWon ? numerator + ' ganhos ÷ ' + denominator + ' entradas' : numerator + ' em ' + (next?.label || 'próxima etapa') + ' ÷ ' + denominator + ' em ' + stage.label,
    };
  });
  return {
    entries, qualifiedIds: qualified, qualificationDates, qualifiedCount: qualified.size,
    qualificationRate: rules.qualifiedIndex >= 0 ? rate(qualified.size, entries.length) : null,
    closingRate: rules.qualifiedIndex >= 0 ? rate(wonDeals.length, qualified.size) : null,
    hasQualifiedStage: rules.qualifiedIndex >= 0,
    wonDeals, lostDeals, unknownQualification, unknownClosure,
    wonRevenue: wonDeals.reduce((sum, deal) => sum + deal.value, 0),
    avgSalesCycle: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    stageData,
  };
}

export type PerformanceMetrics = ReturnType<typeof calculatePerformance>;
