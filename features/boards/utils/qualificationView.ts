import { Board, BoardStage, DealView } from '@/types';

/** Aba ativa da visualização de qualificação. */
export type QualificationTab = 'qualificacao' | 'sql';

/** Um grupo colapsável da lista: etapa do funil + deals dela. */
export interface QualificationGroup {
  stage: BoardStage;
  deals: DealView[];
}

export interface QualificationViewData {
  /** Leads ainda não qualificados, agrupados por etapa (mais avançada primeiro). */
  qualificacao: QualificationGroup[];
  /** Leads do Qualificado em diante, agrupados por etapa (mais avançada primeiro). */
  sql: QualificationGroup[];
  /** undefined quando o funil não tem etapa Qualificado identificável. */
  qualifiedStage?: BoardStage;
  qualificacaoCount: number;
  sqlCount: number;
}

const normalizeLabel = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * Etapa "Qualificado" do funil: prioriza o vínculo com o lifecycle MQL;
 * sem vínculo, cai para o nome da etapa (aceita "Qualificado (MQL)" etc.,
 * mas nunca "Desqualificado", "Não qualificado" nem "Em qualificação").
 */
export function findQualifiedStage(stages: BoardStage[]): BoardStage | undefined {
  const byLifecycle = stages.find((s) => s.linkedLifecycleStage === 'MQL');
  if (byLifecycle) return byLifecycle;
  return stages.find((s) => {
    const label = normalizeLabel(s.label);
    return (
      label.includes('qualificad') &&
      !label.includes('desqualificad') &&
      !label.includes('nao qualificad') &&
      !label.startsWith('em qualifica')
    );
  });
}

const byNewestFirst = (a: DealView, b: DealView) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/**
 * Divide o funil em duas listas, independente da etapa exata:
 * - Qualificação: tudo ANTES da etapa Qualificado (Novo lead, Em
 *   qualificação, Pendência...)
 * - SQL: da etapa Qualificado em diante (Proposta, Contrato...)
 * Etapas de fechamento (Ganho/Perdido/Cliente/Outros) e deals já
 * ganhos/perdidos ficam de fora. Grupos em ordem decrescente do funil
 * (mais avançado primeiro) e deals por data (mais recentes primeiro),
 * espelhando a referência.
 */
export function computeQualificationView(deals: DealView[], board: Board): QualificationViewData {
  const stages = board.stages || [];
  const qualifiedStage = findQualifiedStage(stages);
  const qualifiedIndex = qualifiedStage
    ? stages.findIndex((s) => s.id === qualifiedStage.id)
    : -1;

  const isClosedStage = (s: BoardStage) =>
    s.id === board.wonStageId ||
    s.id === board.lostStageId ||
    s.linkedLifecycleStage === 'CUSTOMER' ||
    s.linkedLifecycleStage === 'OTHER';

  const openDealsByStage = new Map<string, DealView[]>();
  for (const deal of deals) {
    if (deal.isWon || deal.isLost) continue;
    const list = openDealsByStage.get(deal.status);
    if (list) list.push(deal);
    else openDealsByStage.set(deal.status, [deal]);
  }

  const toGroups = (groupStages: BoardStage[]): QualificationGroup[] =>
    groupStages
      .slice()
      .reverse()
      .map((stage) => ({
        stage,
        deals: (openDealsByStage.get(stage.id) || []).slice().sort(byNewestFirst),
      }));

  // Sem etapa Qualificado identificável, tudo aberto conta como "em
  // qualificação" e a aba SQL explica como configurar o funil.
  const preStages = (qualifiedIndex >= 0 ? stages.slice(0, qualifiedIndex) : stages).filter(
    (s) => !isClosedStage(s)
  );
  const sqlStages =
    qualifiedIndex >= 0 ? stages.slice(qualifiedIndex).filter((s) => !isClosedStage(s)) : [];

  const qualificacao = toGroups(preStages);
  const sql = toGroups(sqlStages);
  const count = (groups: QualificationGroup[]) =>
    groups.reduce((acc, g) => acc + g.deals.length, 0);

  return {
    qualificacao,
    sql,
    qualifiedStage,
    qualificacaoCount: count(qualificacao),
    sqlCount: count(sql),
  };
}
