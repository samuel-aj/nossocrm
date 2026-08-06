import React, { useCallback, useMemo, useState } from 'react';
import { DealView, BoardStage, CustomFieldDefinition } from '@/types';
import { DealCard } from './DealCard';
import { isDealRotting } from '@/features/boards/hooks/useBoardsController';
import { MoveToStageModal } from '../Modals/MoveToStageModal';
import { computeActivityStatusMap } from '@/features/boards/utils/dealActivityStatus';
import { useActivities } from '@/lib/query/hooks/useActivitiesQuery';

import { useCRM } from '@/context/CRMContext';
import { Archive, Hourglass, Undo2, UserX } from 'lucide-react';

// Shared immutable default so every card without pending activities reuses
// the same reference — React.memo on DealCard can then bail out on re-renders.
const NO_ACTIVITY_STATUS = { kind: 'none' as const, daysFromToday: 0, daysOverdue: 0 };

// Etapa "Inativos": dias até a devolução automática ao funil.
const INACTIVE_RETURN_DAYS = 30;
const inactiveDaysLeft = (inactiveAt: string) =>
  Math.max(0, INACTIVE_RETURN_DAYS - Math.floor((Date.now() - new Date(inactiveAt).getTime()) / 86_400_000));

/**
 * UI: Drop highlight should follow the stage color.
 *
 * Note on Tailwind: stage colors come from persisted values like `bg-blue-500`.
 * Tailwind only generates classes it can “see” in source, so we map to a finite set
 * of explicit `border-<color>-500`, `bg-<color>-100/20`, and `shadow-<color>-500/30` classes here.
 */
function dropHighlightClasses(stageBgClass?: string): string {
  const c = (stageBgClass ?? '').toLowerCase();

  if (c.includes('blue') || c.includes('sky') || c.includes('cyan')) {
    return 'border-blue-500 bg-blue-100/20 dark:bg-blue-900/30 shadow-xl shadow-blue-500/30';
  }
  if (c.includes('green') || c.includes('emerald')) {
    return 'border-emerald-500 bg-emerald-100/20 dark:bg-emerald-900/30 shadow-xl shadow-emerald-500/30';
  }
  if (c.includes('yellow') || c.includes('amber')) {
    return 'border-amber-500 bg-amber-100/20 dark:bg-amber-900/30 shadow-xl shadow-amber-500/30';
  }
  if (c.includes('orange')) {
    return 'border-orange-500 bg-orange-100/20 dark:bg-orange-900/30 shadow-xl shadow-orange-500/30';
  }
  if (c.includes('red')) {
    return 'border-red-500 bg-red-100/20 dark:bg-red-900/30 shadow-xl shadow-red-500/30';
  }
  if (c.includes('violet') || c.includes('purple')) {
    return 'border-violet-500 bg-violet-100/20 dark:bg-violet-900/30 shadow-xl shadow-violet-500/30';
  }
  if (c.includes('pink') || c.includes('rose')) {
    return 'border-pink-500 bg-pink-100/20 dark:bg-pink-900/30 shadow-xl shadow-pink-500/30';
  }
  if (c.includes('indigo')) {
    return 'border-indigo-500 bg-indigo-100/20 dark:bg-indigo-900/30 shadow-xl shadow-indigo-500/30';
  }
  if (c.includes('teal')) {
    return 'border-teal-500 bg-teal-100/20 dark:bg-teal-900/30 shadow-xl shadow-teal-500/30';
  }

  // Fallback: keep existing behavior-ish (green).
  return 'border-emerald-500 bg-emerald-100/20 dark:bg-emerald-900/30 shadow-xl shadow-emerald-500/30';
}

interface KanbanBoardProps {
  stages: BoardStage[];
  filteredDeals: DealView[];
  customFieldDefinitions: CustomFieldDefinition[];
  draggingId: string | null;
  handleDragStart: (e: React.DragEvent, id: string, title: string) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragEnd: () => void;
  handleDrop: (e: React.DragEvent, stageId: string) => void;
  setSelectedDealId: (id: string | null) => void;
  openActivityMenuId: string | null;
  setOpenActivityMenuId: (id: string | null) => void;
  handleQuickAddActivity: (
    dealId: string,
    type: 'CALL' | 'MEETING' | 'EMAIL',
    dealTitle: string
  ) => void;
  setLastMouseDownDealId: (id: string | null) => void;
  /** Callback to move a deal to a new stage (for keyboard accessibility) */
  onMoveDealToStage?: (dealId: string, newStageId: string) => void;
  // Seleção em massa (modo explícito via menu ⋮)
  selectionMode: boolean;
  selectedDealIds: string[];
  onToggleDealSelection: (dealId: string) => void;
  onToggleStageSelection: (stageId: string) => void;
  // Etapa "Inativos" (opcional por organização)
  inactiveEnabled: boolean;
  inactiveDeals: DealView[];
  onMarkInactive: (dealId: string) => void;
  onRestoreInactive: (dealId: string) => void;
}
/**
 * Componente React `KanbanBoard`.
 *
 * @param {KanbanBoardProps} {
  stages,
  filteredDeals,
  draggingId,
  handleDragStart,
  handleDragOver,
  handleDragEnd,
  handleDrop,
  setSelectedDealId,
  openActivityMenuId,
  setOpenActivityMenuId,
  handleQuickAddActivity,
  setLastMouseDownDealId,
  onMoveDealToStage,
} - Parâmetro `{
  stages,
  filteredDeals,
  draggingId,
  handleDragStart,
  handleDragOver,
  handleDragEnd,
  handleDrop,
  setSelectedDealId,
  openActivityMenuId,
  setOpenActivityMenuId,
  handleQuickAddActivity,
  setLastMouseDownDealId,
  onMoveDealToStage,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  stages,
  filteredDeals,
  customFieldDefinitions,
  draggingId,
  handleDragStart,
  handleDragOver,
  handleDragEnd,
  handleDrop,
  setSelectedDealId,
  openActivityMenuId,
  setOpenActivityMenuId,
  handleQuickAddActivity,
  setLastMouseDownDealId,
  onMoveDealToStage,
  selectionMode,
  selectedDealIds,
  onToggleDealSelection,
  onToggleStageSelection,
  inactiveEnabled,
  inactiveDeals,
  onMarkInactive,
  onRestoreInactive,
}) => {
  const { lifecycleStages, contacts } = useCRM();
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // Contatos INATIVOS: sinalização automática no card (derivada do status do
  // contato — sempre em sincronia; reativar o contato limpa o aviso sozinho).
  const inactiveContactIds = useMemo(
    () => new Set(contacts.filter((c) => c.status === 'INACTIVE').map((c) => c.id)),
    [contacts]
  );

  // Activity status per deal, computed once per render from the activities cache.
  const { data: activities = [] } = useActivities();
  const activityStatusMap = useMemo(
    () => computeActivityStatusMap(filteredDeals, activities),
    [filteredDeals, activities]
  );

  // Stable resolved onMoveToStage — the inline ternary was allocating a new
  // reference per render even when handleOpenMoveToStage itself was stable,
  // which invalidated DealCard's React.memo for every card on every render.
  // We compute it once per change of the two actual inputs.
  
  // State for move-to-stage modal (keyboard accessibility alternative to drag-and-drop)
  const [moveToStageModal, setMoveToStageModal] = useState<{
    isOpen: boolean;
    deal: DealView;
    currentStageId: string;
  } | null>(null);

  /**
   * Performance: o Kanban renderiza listas grandes. Evitamos padrões O(S*N) no render:
   * - Antes: para cada stage, fazia `filteredDeals.filter(...)` + `reduce(...)`.
   * - Agora: agrupamos 1 vez (O(N)) e só lemos por stage (O(S)).
   */
  const dealsByStageId = useMemo(() => {
    const map = new Map<string, DealView[]>();
    const totals = new Map<string, number>();
    for (const deal of filteredDeals) {
      const list = map.get(deal.status);
      if (list) list.push(deal);
      else map.set(deal.status, [deal]);

      totals.set(deal.status, (totals.get(deal.status) ?? 0) + (deal.value ?? 0));
    }
    return { map, totals };
  }, [filteredDeals]);

  // Performance: evita `find` por stage (O(S*L)). Map é O(1) por lookup.
  const lifecycleStageNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ls of lifecycleStages ?? []) {
      if (ls?.id && ls?.name) map.set(ls.id, ls.name);
    }
    return map;
  }, [lifecycleStages]);

  // Performance: index deals by id once so callbacks can stay stable across menu toggles.
  const dealsById = useMemo(() => new Map(filteredDeals.map((d) => [d.id, d])), [filteredDeals]);

  // Performance: keep selection callback stable so DealCard can be memoized.
  const handleSelectDeal = useCallback(
    (dealId: string) => {
      setSelectedDealId(dealId);
    },
    [setSelectedDealId]
  );

  // Handler to open move-to-stage modal (stable across re-renders when only menu state changes)
  const handleOpenMoveToStage = useCallback(
    (dealId: string) => {
      const deal = dealsById.get(dealId);
      if (deal) {
        setMoveToStageModal({
          isOpen: true,
          deal,
          currentStageId: deal.status,
        });
      }
    },
    [dealsById]
  );

  // Stable resolved onMoveToStage passed to DealCard. Replaces the inline
  // ternary `onMoveDealToStage ? handleOpenMoveToStage : undefined` which
  // allocated a new reference every render and broke DealCard's React.memo.
  const resolvedMoveToStage = useMemo(
    () => (onMoveDealToStage ? handleOpenMoveToStage : undefined),
    [onMoveDealToStage, handleOpenMoveToStage]
  );

  // Handler to confirm move to a new stage
  const handleConfirmMoveToStage = (dealId: string, newStageId: string) => {
    if (onMoveDealToStage) {
      onMoveDealToStage(dealId, newStageId);
    }
    setMoveToStageModal(null);
  };

  return (
    // Mobile: uma coluna INTEIRA por vez, com snap (desliza etapa a etapa
    // com uma lasca da próxima aparecendo); antes as colunas ficavam cortadas.
    <div className="flex gap-4 h-full overflow-x-auto pb-2 w-full max-md:snap-x max-md:snap-mandatory max-md:gap-3">
      {stages.map(stage => {
        const stageDeals = dealsByStageId.map.get(stage.id) ?? [];
        const stageValue = dealsByStageId.totals.get(stage.id) ?? 0;
        const isOver = dragOverStage === stage.id && draggingId !== null;

        // Resolve linked stage name
        const linkedStageName =
          stage.linkedLifecycleStage
            ? lifecycleStageNameById.get(stage.linkedLifecycleStage) ?? null
            : null;

        return (
          <div
            key={stage.id}
            onDragOver={(e) => {
              handleDragOver(e);
              setDragOverStage(stage.id);
            }}
            onDrop={(e) => {
              handleDrop(e, stage.id);
              setDragOverStage(null);
            }}
            onDragEnter={() => setDragOverStage(stage.id)}
            onDragLeave={() => setDragOverStage(null)}
            className={`min-w-[20rem] max-md:min-w-[calc(100vw-5.5rem)] max-md:flex-none max-md:snap-center flex-1 flex flex-col rounded-xl border-2 overflow-visible h-full max-h-full transition-all duration-200
                            ${isOver
                ? `${dropHighlightClasses(stage.color)} scale-[1.02]`
                : 'border-slate-200/50 dark:border-white/10 glass'
              }
                        `}
          >
            <div className={`h-1.5 w-full ${stage.color}`}></div>

            <div
              className={`p-3 border-b border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 shrink-0`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 font-display text-sm tracking-wide uppercase">
                  {/* Seleciona/deseleciona todos os leads visíveis desta etapa (só no modo seleção) */}
                  {selectionMode && (
                    <input
                      type="checkbox"
                      checked={stageDeals.length > 0 && stageDeals.every((d) => selectedDealIds.includes(d.id))}
                      onChange={() => onToggleStageSelection(stage.id)}
                      aria-label={`Selecionar todos os negócios de ${stage.label}`}
                      title="Selecionar todos desta etapa"
                      className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    />
                  )}
                  {stage.label}
                </span>
                <span className="text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">
                  {stageDeals.length}
                </span>
              </div>

              {/* Automation Indicator - Always rendered for consistent height */}
              <div className="mb-2 flex items-center gap-1.5 min-h-[22px]">
                {linkedStageName ? (
                  <span className="text-[10px] uppercase font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 px-1.5 py-0.5 rounded border border-primary-100 dark:border-primary-800/50 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-primary-500 animate-pulse"></span>
                    Promove para: {linkedStageName}
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 opacity-0 select-none">
                    Placeholder
                  </span>
                )}
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 font-medium text-right">
                Total:{' '}
                <span className="text-slate-900 dark:text-white font-mono">
                  ${stageValue.toLocaleString()}
                </span>
              </div>
            </div>

            <div
              className={`flex-1 p-2 overflow-y-auto scrollbar-custom space-y-2 bg-slate-100/50 dark:bg-black/20 min-h-[100px]`}
            >
              {stageDeals.length === 0 && !draggingId && (
                <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-600 text-sm py-8">
                  Sem negócios
                </div>
              )}
              {isOver && stageDeals.length === 0 && (
                <div className="h-full flex items-center justify-center text-green-500 dark:text-green-400 text-sm py-8 font-bold animate-pulse pointer-events-none">
                  ✓ Solte aqui!
                </div>
              )}
              {stageDeals.map(deal => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  isRotting={
                    isDealRotting(deal) &&
                    !deal.isWon &&
                    !deal.isLost
                  }
                  activityStatus={activityStatusMap.get(deal.id) ?? NO_ACTIVITY_STATUS}
                  isDragging={draggingId === deal.id}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onSelect={handleSelectDeal}
                  // Performance: avoid passing openMenuId (string) to all cards.
                  // Only 1–2 cards will flip `isMenuOpen` when the menu is toggled.
                  isMenuOpen={openActivityMenuId === deal.id}
                  setOpenMenuId={setOpenActivityMenuId}
                  onQuickAddActivity={handleQuickAddActivity}
                  customFieldDefinitions={customFieldDefinitions}
                  setLastMouseDownDealId={setLastMouseDownDealId}
                  onMoveToStage={resolvedMoveToStage}
                  selectionMode={selectionMode}
                  selected={selectedDealIds.includes(deal.id)}
                  onToggleSelect={onToggleDealSelection}
                  contactInactive={!!deal.contactId && inactiveContactIds.has(deal.contactId)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Coluna INATIVOS (opcional): guarda leads sem resposta; cada um é
          devolvido automaticamente ao funil após 30 dias. Solte um card aqui
          pra guardar; arraste de volta (ou "devolver") pra restaurar. */}
      {inactiveEnabled && (
        <div
          onDragOver={handleDragOver}
          onDrop={(e) => {
            e.preventDefault();
            const dealId = e.dataTransfer.getData('dealId');
            if (dealId) onMarkInactive(dealId);
          }}
          className="min-w-[20rem] max-md:min-w-[calc(100vw-5.5rem)] max-md:flex-none max-md:snap-center flex-1 flex flex-col rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 overflow-visible h-full max-h-full glass"
        >
          <div className="h-1.5 w-full bg-slate-400"></div>
          <div className="p-3 border-b border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 shrink-0">
            <div className="flex justify-between items-center mb-1">
              <span className="flex items-center gap-2 font-bold text-slate-500 dark:text-slate-400 font-display text-sm tracking-wide uppercase">
                <Archive size={14} aria-hidden="true" /> Inativos
              </span>
              <span className="text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">
                {inactiveDeals.length}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              Devolvidos automaticamente ao funil após 30 dias
            </p>
          </div>
          <div className="flex-1 p-2 overflow-y-auto scrollbar-custom space-y-2 bg-slate-100/50 dark:bg-black/20 min-h-[100px]">
            {inactiveDeals.length === 0 && (
              <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-600 text-sm py-8 text-center px-4">
                Arraste aqui os leads que não respondem
              </div>
            )}
            {inactiveDeals.map((deal) => {
              const daysLeft = deal.inactiveAt ? inactiveDaysLeft(deal.inactiveAt) : INACTIVE_RETURN_DAYS;
              const contactInactive = !!deal.contactId && inactiveContactIds.has(deal.contactId);
              return (
                <div
                  key={deal.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, deal.id, deal.title || '')}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleSelectDeal(deal.id)}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800 opacity-75 hover:opacity-100 shadow-sm cursor-grab active:cursor-grabbing transition-all"
                >
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 leading-snug mb-1">
                    {deal.title}
                  </h4>
                  {deal.contactPhone && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{deal.contactPhone}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    {/* Countdown ESPECÍFICO do lead: conta a partir do momento
                        em que ELE entrou em Inativos (inactive_at próprio). */}
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        daysLeft <= 5
                          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                          : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400'
                      }`}
                      title={`Devolução automática em ${daysLeft} dia(s)`}
                    >
                      <Hourglass size={10} aria-hidden="true" />
                      {daysLeft > 0 ? `${daysLeft}d p/ devolver` : 'devolve hoje'}
                    </span>
                    {contactInactive && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                        title="Contato com status INATIVO"
                      >
                        <UserX size={10} aria-hidden="true" /> contato inativo
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestoreInactive(deal.id);
                      }}
                      className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-primary-600 dark:text-primary-400 hover:underline"
                      title="Devolver o lead pro funil agora"
                    >
                      <Undo2 size={10} aria-hidden="true" /> devolver
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Keyboard-accessible modal for moving deals between stages */}
      {moveToStageModal && (
        <MoveToStageModal
          isOpen={moveToStageModal.isOpen}
          onClose={() => setMoveToStageModal(null)}
          onMove={handleConfirmMoveToStage}
          deal={moveToStageModal.deal}
          stages={stages}
          currentStageId={moveToStageModal.currentStageId}
        />
      )}
    </div>
  );
};
