import { describe, expect, it } from 'vitest';
import type { Board, Deal } from '@/types';
import { firstCustomerStage, isAutomaticWonDestination, isAutomaticWonStage, manualWinStage, resolveBoardMoveOutcome } from './boardOutcome';

const board = { id: 'sales', wonStageId: 'protocol', lostStageId: 'lost', stages: [
  { id: 'new', label: 'Novo' }, { id: 'mql', label: 'Qualificado', linkedLifecycleStage: 'MQL' },
  { id: 'contract', label: 'Contrato', linkedLifecycleStage: 'CUSTOMER' },
  { id: 'second-customer', label: 'Cliente confirmado', linkedLifecycleStage: 'CUSTOMER' },
  { id: 'protocol', label: 'Protocolado' }, { id: 'lost', label: 'Perdido' },
] } as Board;
const deal = { boardId: 'sales', status: 'mql', isWon: false, isLost: false } as Deal;
const move = (targetStageId: string, changes: Partial<Deal> = {}, extra = {}) => resolveBoardMoveOutcome({ board, deal: { ...deal, ...changes }, targetStageId, ...extra });

describe('board outcome', () => {
  it('uses Customer identity instead of the legacy manual destination or stage name', () => {
    expect(firstCustomerStage(board)?.id).toBe('contract');
    expect(isAutomaticWonStage(board, 'contract')).toBe(true);
    expect(isAutomaticWonStage(board, 'protocol')).toBe(false);
    expect(move('protocol')).toMatchObject({ isWon: true, newPromotion: true, closedAt: undefined });
    expect(move('contract')).toMatchObject({ isWon: true, newPromotion: true, closedAt: undefined });
    expect(manualWinStage(board, 'mql')?.id).toBe('contract');
  });
  it('does not infer automatic gain from wonStageId when no Customer stage is configured', () => {
    const noCustomer = { ...board, stages: board.stages.filter(stage => stage.linkedLifecycleStage !== 'CUSTOMER') };
    expect(isAutomaticWonStage(noCustomer, 'protocol')).toBe(false);
    expect(isAutomaticWonDestination(noCustomer, 'protocol')).toBe(false);
    expect(manualWinStage(noCustomer, 'mql')?.id).toBe('protocol');
    expect(manualWinStage({ ...board, wonStayInStage: true }, 'mql')?.id).toBe('mql');
  });
  it('keeps the explicit completion rule for boards already managing customers', () => {
    const service = { ...board, linkedLifecycleStage: 'CUSTOMER' };
    expect(firstCustomerStage(service)).toBeUndefined();
    expect(isAutomaticWonStage(service, 'contract')).toBe(false);
    expect(isAutomaticWonStage(service, 'protocol')).toBe(true);
    expect(manualWinStage(service, 'contract')?.id).toBe('protocol');
  });
  it.each(['second-customer', 'protocol'])('retains the original episode and date in %s', target => {
    expect(move(target, { status: 'contract', isWon: true, closedAt: '2026-10-01T12:00:00Z' })).toMatchObject({ isWon: true, newPromotion: false, closedAt: '2026-10-01T12:00:00Z' });
  });
  it('recovers a legacy Customer-stage win without fabricating a timestamp or new automation', () => {
    expect(move('protocol', { status: 'contract' })).toMatchObject({ isWon: true, closedAt: undefined, recoveringLegacyWin: true, newPromotion: false });
    expect(move('second-customer', { status: 'contract', closedAt: '2026-09-15T12:00:00Z' })).toMatchObject({ closedAt: '2026-09-15T12:00:00Z', newPromotion: false });
  });
  it('ends an episode on regression, loss, explicit reopen or board transfer', () => {
    const won = { status: 'contract', isWon: true, closedAt: '2026-10-01T12:00:00Z' };
    expect(move('mql', won)).toMatchObject({ isWon: false, isLost: false, closedAt: undefined });
    expect(move('lost', won)).toMatchObject({ isWon: false, isLost: true, closedAt: undefined });
    expect(move('contract', won, { explicitReopen: true })).toMatchObject({ isWon: false, closedAt: undefined });
    expect(move('protocol', { ...won, boardId: 'other' })).toMatchObject({ isWon: true, closedAt: undefined, newPromotion: true });
  });
  it('does not reopen a closed deal through an unchanged-stage no-op', () => {
    expect(move('mql', { status: 'mql', isWon: true })).toMatchObject({ isWon: true, newPromotion: false });
    expect(move('mql', { status: 'mql', isLost: true })).toMatchObject({ isLost: true, newPromotion: false });
  });
  it('confirms a skipped Customer milestone on a direct move from the first stage', () => {
    expect(move('protocol', { status: 'new' })).toMatchObject({ isWon: true, isLost: false, newPromotion: true });
    expect(move('mql', { status: 'new' })).toMatchObject({ isWon: false, isLost: false, newPromotion: false });
  });
  it('does not silently repair an existing open post-sale card through a no-op', () => {
    expect(move('protocol', { status: 'protocol' })).toMatchObject({ isWon: false, isLost: false, newPromotion: false });
  });
  it('does not count a loss or explicit reopening as cumulative gain', () => {
    expect(move('lost', { status: 'new' })).toMatchObject({ isWon: false, isLost: true });
    expect(move('protocol', { status: 'new' }, { explicitLost: true })).toMatchObject({ isWon: false, isLost: true });
    expect(move('protocol', { status: 'new' }, { explicitReopen: true })).toMatchObject({ isWon: false, isLost: false });
  });
  it('starts a fresh gain when recovering a lost deal directly into post-sale', () => {
    expect(move('protocol', { status: 'lost', isLost: true, closedAt: '2026-10-01T12:00:00Z' }))
      .toMatchObject({ isWon: true, isLost: false, newPromotion: true, closedAt: undefined });
  });
  it('keeps the configured milestone distinct from cumulative destinations', () => {
    expect(isAutomaticWonDestination(board, 'contract')).toBe(true);
    expect(isAutomaticWonDestination(board, 'protocol')).toBe(true);
    expect(isAutomaticWonDestination(board, 'lost')).toBe(false);
    expect(isAutomaticWonDestination(board, 'unknown')).toBe(false);
    expect(isAutomaticWonDestination({ ...board, linkedLifecycleStage: 'CUSTOMER' }, 'contract')).toBe(false);
  });
  it('does not infer a fresh gain from a regression between post-sale stages', () => {
    const withReview = { ...board, stages: [...board.stages, { id: 'review', label: 'Revisão final' }] } as Board;
    expect(resolveBoardMoveOutcome({ board: withReview, deal: { ...deal, status: 'review' }, targetStageId: 'protocol' }))
      .toMatchObject({ isWon: false, isLost: false, newPromotion: false });
  });
});
