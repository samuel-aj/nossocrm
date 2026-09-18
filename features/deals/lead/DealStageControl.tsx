'use client';

/**
 * Mudar funil/etapa de UM negócio (tela do lead e chat). Usa o mesmo movimento
 * central do Kanban (useMoveDeal): atualização otimista no card, no funil e no
 * chat, desfeita sozinha se o servidor recusar; etapa de perda pede o motivo;
 * o histórico e o follow-up por inatividade reagem pelo banco.
 */
import { useState } from 'react';
import { useCRM } from '@/context/CRMContext';
import { useToast } from '@/context/ToastContext';
import { useMoveDeal } from '@/lib/query/hooks/useMoveDeal';
import { useMyActionPermissions } from '@/lib/permissions/useMyActionPermissions';
import { LossReasonModal } from '@/components/ui/LossReasonModal';
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

export function DealStageControl({ deal, size = 'md', align = 'left' }: Props) {
  const { boards, lifecycleStages } = useCRM();
  const { addToast } = useToast();
  const permissions = useMyActionPermissions(deal.boardId);
  const move = useMoveDeal();
  const [pendingLost, setPendingLost] = useState<{ board: Board; stage: BoardStage } | null>(null);

  const doMove = async (board: Board, stage: BoardStage, loss?: { reason: string; category: 'qualified' | 'disqualified' }) => {
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
      });
      addToast(
        board.id !== deal.boardId ? `Lead movido para ${board.name}, etapa ${stage.label}` : `Etapa alterada para ${stage.label}`,
        'success'
      );
    } catch (e) {
      addToast(`Não foi possível mudar a etapa. Nada foi alterado. ${(e as Error)?.message ?? ''}`.trim(), 'error');
    }
  };

  const onPick = (board: Board, stage: BoardStage) => {
    if (!permissions.deals.move) {
      addToast('Sem permissão para mover este lead', 'error');
      return;
    }
    if (isLostStage(board, stage.id)) {
      setPendingLost({ board, stage });
      return;
    }
    void doMove(board, stage);
  };

  return (
    <>
      <StageCascadePicker
        boards={boards}
        boardId={deal.boardId}
        stageId={deal.status}
        onPick={onPick}
        disabled={!permissions.deals.move}
        disabledReason="Sem permissão para mover este lead"
        busy={move.isPending}
        size={size}
        align={align}
      />
      <LossReasonModal
        isOpen={!!pendingLost}
        onClose={() => setPendingLost(null)}
        onConfirm={(reason, category) => {
          const p = pendingLost;
          setPendingLost(null);
          if (p) void doMove(p.board, p.stage, { reason, category });
        }}
        dealTitle={deal.title}
      />
    </>
  );
}
