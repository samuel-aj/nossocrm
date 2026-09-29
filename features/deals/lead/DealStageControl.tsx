'use client';

/**
 * Mudar funil/etapa de UM negócio (tela do lead e chat). Usa o mesmo movimento
 * central do Kanban (useMoveDeal): atualização otimista no card, no funil e no
 * chat, desfeita sozinha se o servidor recusar; etapa de perda pede o motivo;
 * o histórico e o follow-up por inatividade reagem pelo banco.
 */
import { useRef, useState } from 'react';
import { useCRM } from '@/context/CRMContext';
import { useToast } from '@/context/ToastContext';
import { useMoveDeal } from '@/lib/query/hooks/useMoveDeal';
import { useMyActionPermissions } from '@/lib/permissions/useMyActionPermissions';
import { LossReasonModal } from '@/components/ui/LossReasonModal';
import ConfirmModal from '@/components/ConfirmModal';
import type { Board, BoardStage, Deal, DealView } from '@/types';
import { StageCascadePicker } from './StageCascadePicker';

export function isLostStage(board: Board, stageId: string): boolean {
  const s = board.stages.find(x => x.id === stageId);
  return board.lostStageId ? board.lostStageId === stageId : s?.linkedLifecycleStage === 'OTHER';
}

type Props = {
  deal: Deal | DealView;
  size?: 'sm' | 'md';
  align?: 'left' | 'right';
};

type PendingMove = {
  dealId: string;
  sourceBoardId: string;
  sourceStageId: string;
  targetBoardId: string;
  targetStageId: string;
};

export function DealStageControl({ deal, size = 'md', align = 'left' }: Props) {
  const { boards, lifecycleStages } = useCRM();
  const { addToast } = useToast();
  const permissions = useMyActionPermissions(deal.boardId);
  const move = useMoveDeal();
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [pendingLost, setPendingLost] = useState<PendingMove | null>(null);
  const submittingRef = useRef(false);

  const resolveMove = (pending: PendingMove) => {
    if (!permissions.deals.move || pending.dealId !== deal.id || pending.sourceBoardId !== deal.boardId || pending.sourceStageId !== deal.status) return null;
    const source = boards.find(b => b.id === pending.sourceBoardId);
    const target = boards.find(b => b.id === pending.targetBoardId);
    const sourceStage = source?.stages.find(s => s.id === pending.sourceStageId);
    const targetStage = target?.stages.find(s => s.id === pending.targetStageId);
    return source && sourceStage && target && targetStage ? { source, sourceStage, target, targetStage } : null;
  };

  const selectedMove = pendingMove ? resolveMove(pendingMove) : null;
  const targetIsWon = !!selectedMove && !isLostStage(selectedMove.target, selectedMove.targetStage.id) && (
    selectedMove.target.wonStageId
      ? selectedMove.target.wonStageId === selectedMove.targetStage.id
      : selectedMove.target.linkedLifecycleStage !== 'CUSTOMER' && selectedMove.targetStage.linkedLifecycleStage === 'CUSTOMER'
  );
  const targetIsSuccess = targetIsWon || ['MQL', 'SALES_QUALIFIED'].includes(selectedMove?.targetStage.linkedLifecycleStage ?? '');
  const effect = selectedMove && (
    isLostStage(selectedMove.target, selectedMove.targetStage.id)
      ? 'O lead será marcado como perdido após informar o motivo.'
      : selectedMove.target.wonStageId === selectedMove.targetStage.id ||
        (!selectedMove.target.wonStageId && selectedMove.targetStage.linkedLifecycleStage === 'CUSTOMER' && selectedMove.target.linkedLifecycleStage !== 'CUSTOMER')
        ? 'O lead será marcado como ganho.'
        : deal.isWon || deal.isLost ? 'O lead será reaberto no funil de destino.' : null
  );

  const doMove = async (board: Board, stage: BoardStage, loss?: { reason: string; category: 'qualified' | 'disqualified' }, win = false) => {
    if (submittingRef.current || !permissions.deals.move) return;
    submittingRef.current = true;
    try {
      await move.mutateAsync({
        dealId: deal.id,
        targetStageId: stage.id,
        deal,
        board,
        lifecycleStages,
        lossReason: loss?.reason,
        lossCategory: loss?.category,
        explicitLost: !!loss,
        explicitWin: win,
      });
      addToast(
        board.id !== deal.boardId ? `Lead movido para ${board.name}, etapa ${stage.label}` : `Etapa alterada para ${stage.label}`,
        'success'
      );
    } catch (e) {
      addToast(`Não foi possível mudar a etapa. Nada foi alterado. ${(e as Error)?.message ?? ''}`.trim(), 'error');
    } finally {
      submittingRef.current = false;
    }
  };

  const onOutcome = (outcome: 'won' | 'lost') => {
    if (!permissions.deals.move || move.isPending || submittingRef.current) return;
    const board = boards.find(b => b.id === deal.boardId);
    const stage = board?.stages.find(s => s.id === deal.status);
    if (!board || !stage) return;
    if (outcome === 'lost') setPendingLost({ dealId: deal.id, sourceBoardId: deal.boardId, sourceStageId: deal.status, targetBoardId: board.id, targetStageId: stage.id });
    else void doMove(board, stage, undefined, true);
  };

  const onPick = (board: Board, stage: BoardStage) => {
    if (!permissions.deals.move) {
      addToast('Sem permissão para mover este lead', 'error');
      return;
    }
    if (move.isPending || submittingRef.current) return;
    const selection = { dealId: deal.id, sourceBoardId: deal.boardId, sourceStageId: deal.status, targetBoardId: board.id, targetStageId: stage.id };
    if (board.id !== deal.boardId) {
      setPendingMove(selection);
      return;
    }
    if (isLostStage(board, stage.id)) {
      setPendingLost(selection);
      return;
    }
    void doMove(board, stage);
  };

  const confirmMove = () => {
    if (!pendingMove || submittingRef.current || move.isPending) return;
    const resolved = resolveMove(pendingMove);
    setPendingMove(null);
    if (!resolved) {
      addToast('O lead ou a etapa mudou. Selecione o destino novamente.', 'error');
      return;
    }
    if (isLostStage(resolved.target, resolved.targetStage.id)) {
      setPendingLost(pendingMove);
      return;
    }
    void doMove(resolved.target, resolved.targetStage);
  };

  return (
    <>
      <StageCascadePicker
        boards={boards}
        boardId={deal.boardId}
        stageId={deal.status}
        onPick={onPick}
        onOutcome={onOutcome}
        outcome={deal.isWon ? 'won' : deal.isLost ? 'lost' : null}
        disabled={!permissions.deals.move}
        disabledReason="Sem permissão para mover este lead"
        busy={move.isPending || submittingRef.current || !!pendingMove || !!pendingLost}
        size={size}
        align={align}
      />
      <ConfirmModal
        isOpen={!!pendingMove}
        onClose={() => setPendingMove(null)}
        onConfirm={confirmMove}
        title="Deseja mudar lead de funil?"
        message={
          <div className="space-y-2">
            {selectedMove ? <>
              <p>Você vai mover <strong>{deal.title}</strong> para outro funil.</p>
              <p><strong>De:</strong> {selectedMove.source.name} → {selectedMove.sourceStage.label}</p>
              <p><strong>Para:</strong> {selectedMove.target.name} → {selectedMove.targetStage.label}</p>
            </> : <p>A origem ou o destino mudou. Selecione a etapa novamente.</p>}
            {effect && <p>{effect}</p>}
            {deal.contactId && selectedMove?.targetStage.linkedLifecycleStage && <p>A etapa do contato poderá ser atualizada automaticamente.</p>}
            {targetIsSuccess && selectedMove?.target.nextBoardId && <p>As automações do funil de destino poderão criar um lead no próximo funil.</p>}
          </div>
        }
        confirmText="Confirmar mudança de funil"
        variant="primary"
      />
      <LossReasonModal
        isOpen={!!pendingLost}
        onClose={() => setPendingLost(null)}
        onConfirm={(reason, category) => {
          const p = pendingLost && resolveMove(pendingLost);
          setPendingLost(null);
          if (p) void doMove(p.target, p.targetStage, { reason, category });
        }}
        dealTitle={deal.title}
      />
    </>
  );
}
