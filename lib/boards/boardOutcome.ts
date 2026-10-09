import type { Board, BoardStage, Deal } from '@/types';

/** Sales gain is the configured promotion to Customer, never a stage's name. */
export function firstCustomerStage(board: Board): BoardStage | undefined {
  return board.linkedLifecycleStage === 'CUSTOMER' ? undefined
    : board.stages.find(stage => stage.linkedLifecycleStage === 'CUSTOMER');
}

export function isLostBoardStage(board: Board, stageId: string): boolean {
  return board.lostStageId ? stageId === board.lostStageId
    : board.stages.some(stage => stage.id === stageId && stage.linkedLifecycleStage === 'OTHER');
}

export function isAutomaticWonStage(board: Board, stageId: string): boolean {
  if (isLostBoardStage(board, stageId)) return false;
  // Service boards already manage customers: their explicit completion stage
  // keeps its legacy meaning, rather than winning at every Customer column.
  return board.linkedLifecycleStage === 'CUSTOMER' ? stageId === board.wonStageId
    : board.stages.some(stage => stage.id === stageId && stage.linkedLifecycleStage === 'CUSTOMER');
}

/** Destination of an explicit Win action. Archiving deliberately stays put. */
export function manualWinStage(board: Board, currentStageId: string): BoardStage | undefined {
  if (board.wonStayInStage) return board.stages.find(stage => stage.id === currentStageId);
  return firstCustomerStage(board)
    ?? board.stages.find(stage => stage.id === board.wonStageId)
    ?? board.stages.find(stage => stage.id === currentStageId);
}

type OutcomeDeal = Pick<Deal, 'boardId' | 'status' | 'isWon' | 'isLost' | 'closedAt'>;
export function resolveBoardMoveOutcome({ board, deal, targetStageId, explicitWin, explicitLost, explicitReopen }: {
  board: Board; deal: OutcomeDeal; targetStageId: string;
  explicitWin?: boolean; explicitLost?: boolean; explicitReopen?: boolean;
}) {
  const sameBoard = board.id === deal.boardId;
  const first = firstCustomerStage(board);
  const firstIndex = first ? board.stages.findIndex(stage => stage.id === first.id) : -1;
  const targetIndex = board.stages.findIndex(stage => stage.id === targetStageId);
  const sourceIndex = sameBoard ? board.stages.findIndex(stage => stage.id === deal.status) : -1;
  // A legacy Customer column is evidence of the episode, not evidence of its
  // date. The database restores a proven date or keeps it unknown.
  const legacyCustomer = sameBoard && firstIndex >= 0 && !deal.isWon && !deal.isLost && isAutomaticWonStage(board, deal.status);
  const inCustomerRegion = firstIndex >= 0 && targetIndex >= firstIndex;
  const sameStage = sameBoard && deal.status === targetStageId;
  const preserveWin = (sameStage && !!deal.isWon) || (sameBoard && inCustomerRegion && (!!deal.isWon || (legacyCustomer && targetIndex >= sourceIndex)));
  let isWon = false;
  let isLost = false;
  if (explicitReopen) { /* Explicit re-opening always starts another episode. */ }
  else if (explicitLost || (!explicitWin && (isLostBoardStage(board, targetStageId) || (sameStage && deal.isLost)))) isLost = true;
  else if (explicitWin || isAutomaticWonStage(board, targetStageId) || preserveWin) isWon = true;
  const recoveringLegacyWin = isWon && legacyCustomer && !explicitWin;
  const newPromotion = isWon && !(sameBoard && deal.isWon) && !recoveringLegacyWin;
  const closedAt = sameBoard && ((isWon && deal.isWon) || (isLost && deal.isLost) || recoveringLegacyWin)
    ? deal.closedAt : undefined;
  return { isWon, isLost, closedAt, newPromotion, recoveringLegacyWin };
}
