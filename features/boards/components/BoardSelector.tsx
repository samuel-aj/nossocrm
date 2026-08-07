import React, { useMemo, useState } from 'react';
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
  // Drag & drop nativo com REORDENAÇÃO AO VIVO: enquanto arrasta, a lista
  // local vai se reorganizando conforme o item passa por cima dos outros;
  // soltar persiste a ordem (padrão sortable, sem lib externa)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const canReorder = !!onReorderBoards && boards.length > 1;

  const displayBoards = useMemo(() => {
    if (!localOrder) return boards;
    const byId = new Map(boards.map(b => [b.id, b]));
    const ordered = localOrder.map(id => byId.get(id)).filter((b): b is Board => !!b);
    return ordered.length === boards.length ? ordered : boards;
  }, [boards, localOrder]);

  const dragOverRow = (overId: string) => {
    if (!draggingId || draggingId === overId) return;
    setLocalOrder(prev => {
      const ids = prev ?? boards.map(b => b.id);
      const from = ids.indexOf(draggingId);
      const to = ids.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...ids];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };

  // Solta (drop ou dragend): persiste se a ordem mudou e limpa o estado.
  // Drop e dragend podem ambos disparar; o segundo vira no-op (localOrder null).
  const finishDrag = () => {
    if (onReorderBoards && localOrder && localOrder.some((id, i) => boards[i]?.id !== id)) {
      onReorderBoards(localOrder);
    }
    setDraggingId(null);
    setLocalOrder(null);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary-500" />
          <span className="font-medium text-slate-900 dark:text-white max-md:max-w-[7.5rem] max-md:truncate max-md:text-sm">
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
              {displayBoards.map(board => (
                <div
                  key={board.id}
                  data-board-row="true"
                  className={`group flex items-center gap-3 py-3 transition-colors cursor-pointer ${
                    canReorder ? 'pl-1.5 pr-4' : 'px-4'
                  } ${
                    board.id === activeBoard.id
                      ? 'bg-primary-50 dark:bg-primary-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-white/5'
                  } ${draggingId === board.id ? 'opacity-40' : ''}`}
                  onClick={() => { onSelectBoard(board.id); setIsOpen(false); }}
                  onDragOver={canReorder ? (e) => { e.preventDefault(); dragOverRow(board.id); } : undefined}
                  onDrop={canReorder ? (e) => { e.preventDefault(); finishDrag(); } : undefined}
                >
                  {canReorder && (
                    <span
                      draggable
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData('text/board-id', board.id);
                        e.dataTransfer.effectAllowed = 'move';
                        // Fantasma do arraste = a LINHA inteira da pipeline
                        const row = (e.currentTarget as HTMLElement).closest('[data-board-row="true"]');
                        if (row) e.dataTransfer.setDragImage(row as HTMLElement, 24, 20);
                        setDraggingId(board.id);
                        setLocalOrder(boards.map(b => b.id));
                      }}
                      onDragEnd={finishDrag}
                      className="p-1 -mr-1 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 max-md:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
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
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity">
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
