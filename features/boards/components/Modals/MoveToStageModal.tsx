import React, { useCallback, useId, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { BoardStage, DealView } from '@/types';

interface MoveToStageModalProps {
  isOpen: boolean;
  onClose: () => void;
  deal: DealView | null;
  stages: BoardStage[];
  currentStageId: string;
  onMove: (dealId: string, stageId: string) => void;
}

/**
 * MoveToStageModal - Keyboard-accessible alternative to drag-and-drop
 * 
 * Allows users to move a deal to a different stage using only keyboard.
 * This is essential for users who cannot use a mouse for drag-and-drop.
 */
export const MoveToStageModal: React.FC<MoveToStageModalProps> = ({
  isOpen,
  onClose,
  deal,
  stages,
  currentStageId,
  onMove,
}) => {
  const headingId = useId();

  const dealId = deal?.id ?? '';

  const handleMove = useCallback(
    (stageId: string) => {
      if (!dealId) return;
      if (stageId !== currentStageId) {
        onMove(dealId, stageId);
      }
      onClose();
    },
    [currentStageId, dealId, onClose, onMove]
  );

  // Performance: compute once per input change (avoid repeated find+filter).
  const stageData = useMemo(() => {
    const currentStage = stages.find(s => s.id === currentStageId);
    const availableStages = stages.filter(s => s.id !== currentStageId);
    return { currentStage, availableStages };
  }, [currentStageId, stages]);

  if (!deal) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Mover para Estágio"
      size="sm"
      describedById={headingId}
    >
      <div className="space-y-4">
        {/* Current deal info */}
        <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-lg border border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Movendo o negócio:
          </p>
          <p className="font-bold text-slate-900 dark:text-white">
            {deal.title}
          </p>
          {stageData.currentStage && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Estágio atual: <span className="font-medium">{stageData.currentStage.label}</span>
            </p>
          )}
        </div>

        {/* Stage options */}
        <div id={headingId}>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Selecione o novo estágio:
          </p>
          <div className="space-y-2" role="listbox" aria-label="Estágios disponíveis">
            {stageData.availableStages.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => handleMove(stage.id)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-white/10 
                           hover:border-primary-300 dark:hover:border-primary-500/50 
                           hover:bg-primary-50 dark:hover:bg-primary-900/10
                           focus-visible-ring transition-all text-left group"
                autoFocus={index === 0}
              >
                <div 
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: stage.color || '#3b82f6' }}
                  aria-hidden="true"
                />
                <span className="flex-1 font-medium text-slate-700 dark:text-slate-300 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                  {stage.label}
                </span>
                <ArrowRight 
                  size={16} 
                  className="text-slate-400 group-hover:text-primary-500 opacity-0 group-hover:opacity-100 transition-opacity" 
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>

        {/* Cancel button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400
                     hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring"
        >
          Cancelar
        </button>
      </div>
    </Modal>
  );
};

export default MoveToStageModal;
