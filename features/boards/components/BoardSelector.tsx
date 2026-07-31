import React, { useState } from 'react';
import { ChevronDown, GripVertical, Plus, Settings, Trash2 } from 'lucide-react';
import { Board } from '@/types';

interface BoardSelectorProps {
  boards: Board[];
  activeBoard: Board;
  onSelectBoard: (id: string) => void;
  onCreateBoard: () => void;
  onEditBoard?: (board: Board) => void;
  onDeleteBoard?: (id: string) => void;
  /** Arrastar pra reordenar as pipelines: recebe TODOS os ids na nova ordem. */
  onReorderBoards?: (orderedIds: string[]) => void;
}

/**
 * Componente React `BoardSelector`.
 *
 * @param {BoardSelectorProps} {
  boards,
  activeBoard,
  onSelectBoard,
  onCreateBoard,
  onEditBoard,
  onDeleteBoard,
} - Parâmetro `{
  boards,
  activeBoard,
  onSelectBoard,
  onCreateBoard,
  onEditBoard,
  onDeleteBoard,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BoardSelector: React.FC<BoardSelectorProps> = ({
  boards,
  activeBoard,
  onSelectBoard,
  onCreateBoard,
  onEditBoard,
  onDeleteBoard,
  onReorderBoards,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  // Drag & drop nativo (mesmo padrão do reorder de etapas no CreateBoardModal)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const canReorder = !!onReorderBoards && boards.length > 1;

  const moveBoard = (fromId: string, toId: string) => {
    if (!onReorderBoards || fromId === toId) return;
    const ids = boards.map(b => b.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorderBoards(ids);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary-500" />
          <span className="font-medium text-slate-900 dark:text-white">
            {activeBoard.name}
          </span>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden">
            {/* Board List */}
            <div className="max-h-80 overflow-y-auto py-1">
              {boards.map(board => (
                <div
                  key={board.id}
                  className={`group flex items-center gap-3 py-3 transition-colors cursor-pointer ${
                    canReorder ? 'pl-1.5 pr-4' : 'px-4'
                  } ${
                    board.id === activeBoard.id
                      ? 'bg-primary-50 dark:bg-primary-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-white/5'
                  } ${
                    dragOverId === board.id && draggingId && draggingId !== board.id
                      ? 'border-t-2 border-primary-400'
                      : 'border-t-2 border-transparent'
                  } ${draggingId === board.id ? 'opacity-50' : ''}`}
                  onClick={() => { onSelectBoard(board.id); setIsOpen(false); }}
                  onDragOver={canReorder ? (e) => { e.preventDefault(); setDragOverId(board.id); } : undefined}
                  onDragLeave={canReorder ? () => setDragOverId(cur => (cur === board.id ? null : cur)) : undefined}
                  onDrop={
                    canReorder
                      ? (e) => {
                          e.preventDefault();
                          const fromId = e.dataTransfer.getData('text/board-id');
                          if (fromId) moveBoard(fromId, board.id);
                          setDraggingId(null);
                          setDragOverId(null);
                        }
                      : undefined
                  }
                >
                  {canReorder && (
                    <span
                      draggable
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData('text/board-id', board.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDraggingId(board.id);
                      }}
                      onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                      className="p-1 -mr-1 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
                      title="Arrastar pra reordenar"
                    >
                      <GripVertical size={14} />
                    </span>
                  )}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    board.id === activeBoard.id ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${
                      board.id === activeBoard.id
                        ? 'text-primary-600 dark:text-primary-400'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}>
                      {board.name}
                    </p>
                    {board.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {board.description}
                      </p>
                    )}
                  </div>

                  {/* Action buttons - aparecem no hover */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onEditBoard && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditBoard(board);
                          setIsOpen(false);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                        title="Editar board"
                      >
                        <Settings size={14} />
                      </button>
                    )}
                    {/* Pode deletar se não for o único board */}
                    {onDeleteBoard && boards.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteBoard(board.id);
                          setIsOpen(false);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        title="Excluir board"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Create New Board */}
            <div className="border-t border-slate-200 dark:border-white/10">
              <button
                type="button"
                onClick={() => { onCreateBoard(); setIsOpen(false); }}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
              >
                <Plus size={16} />
                Criar novo board
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
