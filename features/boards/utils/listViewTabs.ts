import { Board, BoardStage, DealView } from '@/types';

/**
 * Abas da visualização em lista do pipeline.
 * - todos: comportamento atual (todos os deals filtrados, na ordem original)
 * - qualificados: deals na etapa "Qualificado" do funil, mais recentes primeiro
 * - sql: deals nas etapas de venda após o Qualificado, mais avançados primeiro
 */
export type ListTabId = 'todos' | 'qualificados' | 'sql';

const normalizeLabel = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * Etapa "Qualificado" do funil: prioriza o vínculo com o lifecycle MQL;
 * sem vínculo, cai para o nome da etapa (aceita "Qualificado (MQL)" etc.,
 * mas nunca "Desqualificado" nem "Em qualificação").
 */
export function findQualifiedStage(stages: BoardStage[]): BoardStage | undefined {
  const byLifecycle = stages.find((s) => s.linkedLifecycleStage === 'MQL');
  if (byLifecycle) return byLifecycle;
  return stages.find((s) => {
    const label = normalizeLabel(s.label);
    return (
      label.includes('qualificad') &&
      !label.includes('desqualificad') &&
      !label.startsWith('em qualifica')
    );
  });
}

/**
 * Etapas de venda (SQL): tudo que vem DEPOIS do Qualificado na ordem do
 * funil, excluindo etapas de fechamento (Ganho/Perdido/Cliente/Outros).
 * Sem etapa Qualificado identificável, cai para as etapas ligadas ao
 * lifecycle Oportunidade (PROSPECT).
 */
export function findSqlStages(board: Board): BoardStage[] {
  const stages = board.stages || [];
  const isClosedStage = (s: BoardStage) =>
    s.id === board.wonStageId ||
    s.id === board.lostStageId ||
    s.linkedLifecycleStage === 'CUSTOMER' ||
    s.linkedLifecycleStage === 'OTHER';

  const qualified = findQualifiedStage(stages);
  if (!qualified) {
    return stages.filter((s) => s.linkedLifecycleStage === 'PROSPECT' && !isClosedStage(s));
  }
  const start = stages.findIndex((s) => s.id === qualified.id);
  return stages.slice(start + 1).filter((s) => !isClosedStage(s));
}

export interface ListTabsResult {
  todos: DealView[];
  qualificados: DealView[];
  sql: DealView[];
  /** undefined quando o funil não tem etapa Qualificado identificável. */
  qualifiedStage?: BoardStage;
  sqlStages: BoardStage[];
}

const byNewestFirst = (getDate: (d: DealView) => string) => (a: DealView, b: DealView) =>
  new Date(getDate(b)).getTime() - new Date(getDate(a)).getTime();

/**
 * Calcula as três abas de uma vez (uma passada por aba, memoizável no
 * componente). Qualificados e SQL consideram apenas deals abertos.
 */
export function computeListTabs(deals: DealView[], board: Board): ListTabsResult {
  const qualifiedStage = findQualifiedStage(board.stages || []);
  const sqlStages = findSqlStages(board);

  const qualificados = qualifiedStage
    ? deals
        .filter((d) => !d.isWon && !d.isLost && d.status === qualifiedStage.id)
        .sort(byNewestFirst((d) => d.createdAt))
    : [];

  // Posição de cada etapa SQL na ordem do funil, para ordenar "mais
  // avançado primeiro" com desempate por data de criação.
  const stagePosition = new Map<string, number>();
  (board.stages || []).forEach((s, index) => stagePosition.set(s.id, index));
  const sqlStageIds = new Set(sqlStages.map((s) => s.id));

  const sql = deals
    .filter((d) => !d.isWon && !d.isLost && sqlStageIds.has(d.status))
    .sort((a, b) => {
      const stageDiff = (stagePosition.get(b.status) ?? 0) - (stagePosition.get(a.status) ?? 0);
      if (stageDiff !== 0) return stageDiff;
      return byNewestFirst((d: DealView) => d.createdAt)(a, b);
    });

  return { todos: deals, qualificados, sql, qualifiedStage, sqlStages };
}
