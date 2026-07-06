import React from 'react';
import { DealDetailModal } from './Modals/DealDetailModal';
import { CreateDealModal } from './Modals/CreateDealModal';
import { CreateBoardModal } from './Modals/CreateBoardModal';
import { BoardCreationWizard } from './BoardCreationWizard';
import { KanbanHeader } from './Kanban/KanbanHeader';
import { BoardStrategyHeader } from './Kanban/BoardStrategyHeader';
import { KanbanBoard } from './Kanban/KanbanBoard';
import { KanbanList } from './Kanban/KanbanList';
import { DeleteBoardModal } from './Modals/DeleteBoardModal';
import { LossReasonModal } from '@/components/ui/LossReasonModal';
import ConfirmModal from '@/components/ConfirmModal';
import { CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { DealView, CustomFieldDefinition, Board, BoardStage } from '@/types';
import { ExportTemplateModal } from './Modals/ExportTemplateModal';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/PageLoader';
import { UserRole } from '@/types/constants';

/**
 * Zona de soltar (drop target) da barra flutuante que aparece durante o drag
 * de um card (estilo Kommo). Realça quando o card está por cima.
 */
function DragDropZone({
  onDropCard,
  className,
  children,
}: {
  onDropCard: (e: React.DragEvent) => void;
  className: string;
  children: React.ReactNode;
}) {
  const [over, setOver] = React.useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDropCard(e);
      }}
      className={`flex items-center gap-2 px-8 py-4 rounded-xl border-2 border-dashed font-bold text-sm shadow-xl backdrop-blur-sm transition-all select-none ${over ? 'scale-110' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

interface PipelineViewProps {
  // Boards
  boards: Board[];
  activeBoard: Board | null;
  activeBoardId: string | null;
  handleSelectBoard: (id: string) => void;
  handleCreateBoard: (board: Omit<Board, 'id' | 'createdAt'>, order?: number) => void;
  createBoardAsync?: (board: Omit<Board, 'id' | 'createdAt'>, order?: number) => Promise<Board>;
  updateBoardAsync?: (id: string, updates: Partial<Board>) => Promise<void>;
  handleEditBoard: (board: Board) => void;
  handleUpdateBoard: (board: Omit<Board, 'id' | 'createdAt'>) => void;
  handleDeleteBoard: (id: string) => void;
  confirmDeleteBoard: () => void;
  boardToDelete: { id: string; name: string; dealCount: number; targetBoardId?: string } | null;
  setBoardToDelete: (board: { id: string; name: string; dealCount: number; targetBoardId?: string } | null) => void;
  setTargetBoardForDelete: (targetBoardId: string) => void;
  availableBoardsForMove: Board[];
  isCreateBoardModalOpen: boolean;
  setIsCreateBoardModalOpen: (isOpen: boolean) => void;
  isWizardOpen: boolean;
  setIsWizardOpen: (isOpen: boolean) => void;
  editingBoard: Board | null;
  setEditingBoard: (board: Board | null) => void;
  // View
  viewMode: 'kanban' | 'list';
  setViewMode: (mode: 'kanban' | 'list') => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  ownerFilter: string;
  setOwnerFilter: (filter: string) => void;
  customFieldFilters: Record<string, string>;
  setCustomFieldFilters: (f: Record<string, string>) => void;
  customFieldOptions: Array<{ key: string; label: string; kind: 'select' | 'text'; options: string[] }>;
  statusFilter: 'open' | 'won' | 'lost' | 'all';
  setStatusFilter: (filter: 'open' | 'won' | 'lost' | 'all') => void;
  draggingId: string | null;
  selectedDealId: string | null;
  setSelectedDealId: (id: string | null) => void;
  isCreateModalOpen: boolean;
  setIsCreateModalOpen: (isOpen: boolean) => void;
  openActivityMenuId: string | null;
  setOpenActivityMenuId: (id: string | null) => void;
  filteredDeals: DealView[];
  customFieldDefinitions: CustomFieldDefinition[];
  isLoading: boolean;
  handleDragStart: (e: React.DragEvent, id: string, title: string) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragEnd: () => void;
  handleDrop: (e: React.DragEvent, stageId: string) => void;
  // Zonas flutuantes de drag (Ganho/Perdido/Excluir)
  deleteDealModal: { dealId: string; dealTitle: string } | null;
  handleDropDelete: (dealId: string) => void;
  handleDeleteDealConfirm: () => void;
  handleDeleteDealClose: () => void;
  /** Keyboard-accessible handler to move a deal to a new stage */
  handleMoveDealToStage: (dealId: string, newStageId: string) => void;
  handleQuickAddActivity: (
    dealId: string,
    type: 'CALL' | 'MEETING' | 'EMAIL',
    dealTitle: string
  ) => void;
  setLastMouseDownDealId: (id: string | null) => void;
  /** Hint consumed once by DealDetailModal to pre-open the quick-activity form. */
  scheduleHint?: { type: 'CALL' | 'MEETING' | 'EMAIL' } | null;
  clearScheduleHint?: () => void;
  // Loss Reason Modal
  lossReasonModal: {
    isOpen: boolean;
    dealId: string;
    dealTitle: string;
    stageId: string;
  } | null;
  handleLossReasonConfirm: (reason: string) => void;
  handleLossReasonClose: () => void;
  boardCreateOverlay?: { title: string; subtitle?: string } | null;
}

/**
 * Componente React `PipelineView`.
 *
 * @param {PipelineViewProps} {
  // Boards
  boards,
  activeBoard,
  activeBoardId,
  handleSelectBoard,
  handleCreateBoard,
  createBoardAsync,
  updateBoardAsync,
  handleEditBoard,
  handleUpdateBoard,
  handleDeleteBoard,
  confirmDeleteBoard,
  boardToDelete,
  setBoardToDelete,
  setTargetBoardForDelete,
  availableBoardsForMove,
  isCreateBoardModalOpen,
  setIsCreateBoardModalOpen,
  isWizardOpen,
  setIsWizardOpen,
  editingBoard,
  setEditingBoard,
  // View
  viewMode,
  setViewMode,
  searchTerm,
  setSearchTerm,
  ownerFilter,
  setOwnerFilter,
  statusFilter,
  setStatusFilter,
  draggingId,
  selectedDealId,
  setSelectedDealId,
  isCreateModalOpen,
  setIsCreateModalOpen,
  openActivityMenuId,
  setOpenActivityMenuId,
  filteredDeals,
  customFieldDefinitions,
  isLoading,
  handleDragStart,
  handleDragOver,
  handleDrop,
  handleMoveDealToStage,
  handleQuickAddActivity,
  setLastMouseDownDealId,
  // Loss Reason Modal
  lossReasonModal,
  handleLossReasonConfirm,
  handleLossReasonClose,
} - Parâmetro `{
  // Boards
  boards,
  activeBoard,
  activeBoardId,
  handleSelectBoard,
  handleCreateBoard,
  createBoardAsync,
  updateBoardAsync,
  handleEditBoard,
  handleUpdateBoard,
  handleDeleteBoard,
  confirmDeleteBoard,
  boardToDelete,
  setBoardToDelete,
  setTargetBoardForDelete,
  availableBoardsForMove,
  isCreateBoardModalOpen,
  setIsCreateBoardModalOpen,
  isWizardOpen,
  setIsWizardOpen,
  editingBoard,
  setEditingBoard,
  // View
  viewMode,
  setViewMode,
  searchTerm,
  setSearchTerm,
  ownerFilter,
  setOwnerFilter,
  statusFilter,
  setStatusFilter,
  draggingId,
  selectedDealId,
  setSelectedDealId,
  isCreateModalOpen,
  setIsCreateModalOpen,
  openActivityMenuId,
  setOpenActivityMenuId,
  filteredDeals,
  customFieldDefinitions,
  isLoading,
  handleDragStart,
  handleDragOver,
  handleDrop,
  handleMoveDealToStage,
  handleQuickAddActivity,
  setLastMouseDownDealId,
  // Loss Reason Modal
  lossReasonModal,
  handleLossReasonConfirm,
  handleLossReasonClose,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const PipelineView: React.FC<PipelineViewProps> = ({
  customFieldFilters,
  setCustomFieldFilters,
  customFieldOptions,
  deleteDealModal,
  handleDropDelete,
  handleDeleteDealConfirm,
  handleDeleteDealClose,
  // Boards
  boards,
  activeBoard,
  activeBoardId,
  handleSelectBoard,
  handleCreateBoard,
  createBoardAsync,
  updateBoardAsync,
  handleEditBoard,
  handleUpdateBoard,
  handleDeleteBoard,
  confirmDeleteBoard,
  boardToDelete,
  setBoardToDelete,
  setTargetBoardForDelete,
  availableBoardsForMove,
  isCreateBoardModalOpen,
  setIsCreateBoardModalOpen,
  isWizardOpen,
  setIsWizardOpen,
  editingBoard,
  setEditingBoard,
  // View
  viewMode,
  setViewMode,
  searchTerm,
  setSearchTerm,
  ownerFilter,
  setOwnerFilter,
  statusFilter,
  setStatusFilter,
  draggingId,
  selectedDealId,
  setSelectedDealId,
  isCreateModalOpen,
  setIsCreateModalOpen,
  openActivityMenuId,
  setOpenActivityMenuId,
  filteredDeals,
  customFieldDefinitions,
  isLoading,
  handleDragStart,
  handleDragOver,
  handleDragEnd,
  handleDrop,
  handleMoveDealToStage,
  handleQuickAddActivity,
  setLastMouseDownDealId,
  scheduleHint,
  clearScheduleHint,
  // Loss Reason Modal
  lossReasonModal,
  handleLossReasonConfirm,
  handleLossReasonClose,
  boardCreateOverlay,
}) => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === UserRole.ADMIN || profile?.role === UserRole.SUPER_ADMIN;
  const [isExportModalOpen, setIsExportModalOpen] = React.useState(false);

  const handleUpdateStage = (updatedStage: BoardStage) => {
    if (!activeBoard) return;
    const newStages = activeBoard.stages.map(s => (s.id === updatedStage.id ? updatedStage : s));
    handleUpdateBoard({ ...activeBoard, stages: newStages });
  };

  if (isLoading) {
    return (
      <div className="h-full">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {boardCreateOverlay && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
          <div className="relative z-10 w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-white/95 dark:bg-slate-900/95 backdrop-blur p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-5 w-5 rounded-full border-2 border-primary-500/30 border-t-primary-500 animate-spin" />
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-slate-900 dark:text-white">
                  {boardCreateOverlay.title}
                </div>
                {boardCreateOverlay.subtitle && (
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {boardCreateOverlay.subtitle}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4">
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                <div className="h-full w-1/2 bg-primary-500/80 animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      )}
      {boards.length === 0 ? (
        // Empty state DE VERDADE — não há nenhum board criado para a org.
        // Antes esse bloco era exibido quando !activeBoard, mas isso causava
        // falso-positivo durante a janela em que boards já carregaram e o
        // activeBoardId ainda não foi resolvido pelo useEffect do controller.
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="w-24 h-24 bg-primary-50 dark:bg-primary-900/20 rounded-full flex items-center justify-center mb-6">
            <span className="text-4xl">🚀</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            Bem-vindo ao seu CRM
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-md mb-8">
            Você ainda não tem nenhum board criado. Comece criando seu primeiro fluxo de trabalho
            para organizar seus negócios.
          </p>
          <button
            onClick={() => setIsWizardOpen(true)}
            className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-primary-600/20"
          >
            ✨ Criar meu primeiro Board
          </button>
        </div>
      ) : !activeBoard ? (
        // Transient: boards carregados mas activeBoard ainda não foi escolhido.
        // Mostra loader em vez de empty state.
        <div className="h-full">
          <PageLoader />
        </div>
      ) : (
        <>
          <KanbanHeader
            boards={boards}
            activeBoard={activeBoard}
            onSelectBoard={handleSelectBoard}
            onCreateBoard={() => setIsWizardOpen(true)}
            onEditBoard={handleEditBoard}
            onDeleteBoard={handleDeleteBoard}
            onExportTemplates={isAdmin ? () => setIsExportModalOpen(true) : undefined}
            viewMode={viewMode}
            setViewMode={setViewMode}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            ownerFilter={ownerFilter}
            setOwnerFilter={setOwnerFilter}
            customFieldFilters={customFieldFilters}
            setCustomFieldFilters={setCustomFieldFilters}
            customFieldOptions={customFieldOptions}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onNewDeal={() => setIsCreateModalOpen(true)}
          />

          <BoardStrategyHeader board={activeBoard} />

          <div className="flex-1 overflow-hidden">
            {viewMode === 'kanban' ? (
              <KanbanBoard
                stages={activeBoard.stages}
                filteredDeals={filteredDeals}
                customFieldDefinitions={customFieldDefinitions}
                draggingId={draggingId}
                handleDragStart={handleDragStart}
                handleDragOver={handleDragOver}
                handleDragEnd={handleDragEnd}
                handleDrop={handleDrop}
                setSelectedDealId={setSelectedDealId}
                openActivityMenuId={openActivityMenuId}
                setOpenActivityMenuId={setOpenActivityMenuId}
                handleQuickAddActivity={handleQuickAddActivity}
                setLastMouseDownDealId={setLastMouseDownDealId}
                onMoveDealToStage={handleMoveDealToStage}
              />
            ) : (
              <KanbanList
                stages={activeBoard.stages}
                filteredDeals={filteredDeals}
                customFieldDefinitions={customFieldDefinitions}
                setSelectedDealId={setSelectedDealId}
                openActivityMenuId={openActivityMenuId}
                setOpenActivityMenuId={setOpenActivityMenuId}
                handleQuickAddActivity={handleQuickAddActivity}
                onMoveDealToStage={handleMoveDealToStage}
              />
            )}
          </div>
        </>
      )}

      <CreateDealModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        activeBoard={activeBoard}
        activeBoardId={activeBoardId ?? undefined}
      />

      <DealDetailModal
        dealId={selectedDealId}
        isOpen={!!selectedDealId}
        onClose={() => setSelectedDealId(null)}
        scheduleHint={scheduleHint ?? null}
        onScheduleHintConsumed={clearScheduleHint}
      />

      <CreateBoardModal
        isOpen={isCreateBoardModalOpen}
        onClose={() => {
          setIsCreateBoardModalOpen(false);
          setEditingBoard(null);
        }}
        onSave={editingBoard ? handleUpdateBoard : handleCreateBoard}
        editingBoard={editingBoard || undefined}
        availableBoards={boards}
        onSwitchEditingBoard={handleEditBoard}
      />

      <BoardCreationWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onCreate={handleCreateBoard}
        onCreateBoardAsync={createBoardAsync}
        onUpdateBoardAsync={updateBoardAsync}
        onOpenCustomModal={() => setIsCreateBoardModalOpen(true)}
      />

      <DeleteBoardModal
        isOpen={!!boardToDelete}
        onClose={() => setBoardToDelete(null)}
        onConfirm={confirmDeleteBoard}
        boardName={boardToDelete?.name || ''}
        dealCount={boardToDelete?.dealCount || 0}
        availableBoards={availableBoardsForMove}
        selectedTargetBoardId={boardToDelete?.targetBoardId}
        onSelectTargetBoard={setTargetBoardForDelete}
      />

      <LossReasonModal
        isOpen={lossReasonModal?.isOpen ?? false}
        onClose={handleLossReasonClose}
        onConfirm={handleLossReasonConfirm}
        dealTitle={lossReasonModal?.dealTitle}
      />

      {/* Barra flutuante de drag (estilo Kommo): solta o card em Ganho/Perdido/Excluir */}
      {draggingId && activeBoard && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex gap-3">
          {activeBoard.wonStageId && (
            <DragDropZone
              onDropCard={(e) => handleDrop(e, activeBoard.wonStageId!)}
              className="border-green-400 bg-green-50/95 text-green-700 dark:bg-green-900/80 dark:text-green-300"
            >
              <CheckCircle2 size={18} /> Ganho
            </DragDropZone>
          )}
          {activeBoard.lostStageId && (
            <DragDropZone
              onDropCard={(e) => handleDrop(e, activeBoard.lostStageId!)}
              className="border-red-400 bg-red-50/95 text-red-700 dark:bg-red-900/80 dark:text-red-300"
            >
              <XCircle size={18} /> Perdido
            </DragDropZone>
          )}
          <DragDropZone
            onDropCard={(e) => {
              e.preventDefault();
              const dealId = e.dataTransfer.getData('dealId');
              if (dealId) handleDropDelete(dealId);
            }}
            className="border-slate-400 bg-slate-100/95 text-slate-700 dark:bg-slate-800/90 dark:text-slate-200"
          >
            <Trash2 size={18} /> Excluir
          </DragDropZone>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteDealModal}
        onClose={handleDeleteDealClose}
        onConfirm={handleDeleteDealConfirm}
        title="Excluir negócio"
        message={`Excluir "${deleteDealModal?.dealTitle ?? ''}"? Esta ação não pode ser desfeita.`}
        confirmText="Excluir"
        variant="danger"
      />

      {activeBoard && (
        <ExportTemplateModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          boards={boards}
          activeBoard={activeBoard}
          onCreateBoardAsync={createBoardAsync}
        />
      )}
    </div>
  );
};
