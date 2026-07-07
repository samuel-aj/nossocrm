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
 * Zona de soltar da barra flutuante do drag (estilo Kommo), com visual de
 * PREVIEW de coluna do board: barra de cor do estágio + título + área
 * tracejada "Solte aqui". Realça quando o card está por cima.
 */
function DragDropZone({
  onDropCard,
  colorBar,
  title,
  icon,
  overClass,
}: {
  onDropCard: (e: React.DragEvent) => void;
  colorBar: string;
  title: string;
  icon: React.ReactNode;
  /** Classes aplicadas quando o card está POR CIMA da zona (cor de destaque). */
  overClass: string;
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
      className={`w-56 rounded-xl overflow-hidden border-2 shadow-2xl backdrop-blur-sm transition-all duration-200 ease-out select-none ${
        over
          ? `scale-110 -translate-y-2 border-solid ${overClass}`
          : 'border-dashed border-slate-300 dark:border-slate-600 bg-white/95 dark:bg-slate-900/90'
      }`}
    >
      {/* pointer-events-none: evita flicker do dragenter/dragleave nos filhos */}
      <div className="pointer-events-none">
        <div className={`${over ? 'h-2.5' : 'h-1.5'} w-full transition-all ${colorBar}`} />
        <div className="px-3 py-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          <span className={over ? 'animate-bounce' : ''}>{icon}</span>
          <span className="truncate">{title}</span>
        </div>
        <div
          className={`mx-3 mb-3 h-12 rounded-lg border-2 border-dashed flex items-center justify-center text-[11px] transition-colors ${
            over
              ? 'border-current font-bold text-slate-800 dark:text-white'
              : 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'
          }`}
        >
          {over ? 'Pode soltar!' : 'Solte aqui'}
        </div>
      </div>
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
  customFieldConditions: Array<{ id: string; field: string; operator: 'contains' | 'equals' | 'empty' | 'not_empty'; value: string }>;
  setCustomFieldConditions: (c: Array<{ id: string; field: string; operator: 'contains' | 'equals' | 'empty' | 'not_empty'; value: string }>) => void;
  customFieldLogic: 'AND' | 'OR';
  setCustomFieldLogic: (l: 'AND' | 'OR') => void;
  customFieldOptions: Array<{ key: string; label: string; kind: 'select' | 'text'; options: string[] }>;
  tagFilter: string;
  setTagFilter: (v: string) => void;
  tagOptions: string[];
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
  customFieldConditions,
  setCustomFieldConditions,
  customFieldLogic,
  setCustomFieldLogic,
  customFieldOptions,
  tagFilter,
  setTagFilter,
  tagOptions,
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

  // Visão padrão ("Em Aberto") esconde as COLUNAS de ganho/perdido do Kanban —
  // elas só aparecem ao filtrar por Ganhos/Perdidos/Todos. Marcar ganho/perdido
  // no dia a dia é pelas zonas flutuantes do drag (ou trocando o filtro).
  const kanbanStages = !activeBoard
    ? []
    : statusFilter === 'open'
      ? activeBoard.stages.filter(
          (s) => s.id !== activeBoard.wonStageId && s.id !== activeBoard.lostStageId
        )
      : activeBoard.stages;

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
            customFieldConditions={customFieldConditions}
            setCustomFieldConditions={setCustomFieldConditions}
            customFieldLogic={customFieldLogic}
            setCustomFieldLogic={setCustomFieldLogic}
            customFieldOptions={customFieldOptions}
            tagFilter={tagFilter}
            setTagFilter={setTagFilter}
            tagOptions={tagOptions}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onNewDeal={() => setIsCreateModalOpen(true)}
          />

          <BoardStrategyHeader board={activeBoard} />

          <div className="flex-1 overflow-hidden">
            {viewMode === 'kanban' ? (
              <KanbanBoard
                stages={kanbanStages}
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

      {/* Barra flutuante de drag (estilo Kommo): previews das colunas de
          Ganho/Perdido (label + cor do estágio real) + Excluir */}
      {draggingId && activeBoard && (() => {
        const wonStage = activeBoard.stages.find((s) => s.id === activeBoard.wonStageId);
        const lostStage = activeBoard.stages.find((s) => s.id === activeBoard.lostStageId);
        return (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex gap-3">
            {activeBoard.wonStageId && (
              <DragDropZone
                onDropCard={(e) => handleDrop(e, activeBoard.wonStageId!)}
                colorBar={wonStage?.color || 'bg-green-500'}
                title={wonStage?.label || 'Ganho'}
                icon={<CheckCircle2 size={14} className="text-green-500 shrink-0" />}
                overClass="border-green-500 bg-green-100/95 dark:bg-green-900/70 ring-4 ring-green-400/50"
              />
            )}
            {activeBoard.lostStageId && (
              <DragDropZone
                onDropCard={(e) => handleDrop(e, activeBoard.lostStageId!)}
                colorBar={lostStage?.color || 'bg-red-500'}
                title={lostStage?.label || 'Perdido'}
                icon={<XCircle size={14} className="text-red-500 shrink-0" />}
                overClass="border-red-500 bg-red-100/95 dark:bg-red-900/70 ring-4 ring-red-400/50"
              />
            )}
            <DragDropZone
              onDropCard={(e) => {
                e.preventDefault();
                const dealId = e.dataTransfer.getData('dealId');
                if (dealId) handleDropDelete(dealId);
              }}
              colorBar="bg-slate-500"
              title="Excluir"
              icon={<Trash2 size={14} className="text-slate-500 shrink-0" />}
              overClass="border-red-700 bg-red-100/95 dark:bg-red-950/80 ring-4 ring-red-600/40"
            />
          </div>
        );
      })()}

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
