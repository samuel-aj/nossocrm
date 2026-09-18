'use client';

/**
 * Seletor compacto de FUNIL e ETAPA em cascata: à esquerda os funis, à direita
 * as etapas do funil em foco (com a cor de cada etapa). Teclado: setas sobem e
 * descem, seta para a direita (ou Enter) entra nas etapas, seta para a esquerda
 * volta aos funis, Enter escolhe, Esc fecha.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { Board, BoardStage } from '@/types';

type Props = {
  boards: Board[];
  boardId: string;
  stageId: string;
  onPick: (board: Board, stage: BoardStage) => void;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  /** 'sm': barra do chat; 'md': coluna de dados do lead */
  size?: 'sm' | 'md';
  align?: 'left' | 'right';
};

export function StageCascadePicker({
  boards,
  boardId,
  stageId,
  onPick,
  disabled = false,
  disabledReason,
  busy = false,
  size = 'md',
  align = 'left',
}: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<'boards' | 'stages'>('stages');
  const [boardIdx, setBoardIdx] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const board = boards.find(b => b.id === boardId) ?? null;
  const stage = board?.stages.find(s => s.id === stageId) ?? null;
  const focusBoard = boards[boardIdx] ?? null;
  const focusStages = useMemo(() => focusBoard?.stages ?? [], [focusBoard]);

  const openPanel = () => {
    if (disabled || busy) return;
    const bi = Math.max(0, boards.findIndex(b => b.id === boardId));
    const si = Math.max(0, boards[bi]?.stages.findIndex(s => s.id === stageId) ?? 0);
    setBoardIdx(bi);
    setStageIdx(si);
    setPane('stages');
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // item em foco sempre visível na lista
  useEffect(() => {
    if (!open) return;
    const id = pane === 'boards' ? `${listId}-b-${boardIdx}` : `${listId}-s-${stageIdx}`;
    document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
  }, [open, pane, boardIdx, stageIdx, listId]);

  const choose = (b: Board, s: BoardStage) => {
    close();
    if (b.id === boardId && s.id === stageId) return;
    onPick(b, s);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    const n = pane === 'boards' ? boards.length : focusStages.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : n - 1;
      if (pane === 'boards') {
        setBoardIdx(i => (i + step) % n);
        setStageIdx(0);
      } else setStageIdx(i => (i + step) % n);
    } else if (e.key === 'ArrowRight' || (e.key === 'Enter' && pane === 'boards')) {
      e.preventDefault();
      if (focusStages.length) setPane('stages');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPane('boards');
    } else if (e.key === 'Enter' && pane === 'stages') {
      e.preventDefault();
      const s = focusStages[stageIdx];
      if (focusBoard && s) choose(focusBoard, s);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const idx = e.key === 'Home' ? 0 : Math.max(0, n - 1);
      if (pane === 'boards') setBoardIdx(idx);
      else setStageIdx(idx);
    }
  };

  const sm = size === 'sm';
  const activeId = pane === 'boards' ? `${listId}-b-${boardIdx}` : `${listId}-s-${stageIdx}`;

  return (
    <div ref={rootRef} className="relative min-w-0" {...(open ? { 'data-esc-local': '' } : {})}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={e => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openPanel();
          }
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={disabled ? disabledReason || 'Sem permissão para mover este lead' : 'Mudar funil ou etapa'}
        className={`group w-full min-w-0 inline-flex items-center gap-2 rounded-lg border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          sm ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm'
        } border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-primary-300 dark:hover:border-primary-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
      >
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${stage?.color ?? 'bg-slate-300'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
          <span className={`truncate text-slate-500 dark:text-slate-400 ${sm ? 'max-w-[110px]' : 'max-w-[45%]'}`}>{board?.name ?? 'Funil'}</span>
          <ChevronRight size={11} className="shrink-0 self-center text-slate-300 dark:text-slate-600" aria-hidden="true" />
          <span className="truncate font-semibold text-slate-800 dark:text-white">{stage?.label ?? 'Sem etapa'}</span>
        </span>
        {busy ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-slate-400" />
        ) : (
          <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          role="listbox"
          aria-label="Funil e etapa"
          aria-activedescendant={activeId}
          className={`absolute z-50 mt-1.5 w-[min(92vw,460px)] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shadow-xl outline-none animate-in fade-in slide-in-from-top-1 duration-150 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] max-h-[320px]">
            <div className="border-r border-slate-100 dark:border-white/5 overflow-y-auto scrollbar-custom p-1.5">
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Funil</p>
              {boards.map((b, i) => {
                const focused = pane === 'boards' && i === boardIdx;
                const highlighted = i === boardIdx;
                return (
                  <div
                    key={b.id}
                    id={`${listId}-b-${i}`}
                    role="option"
                    aria-selected={b.id === boardId}
                    onMouseEnter={() => {
                      setBoardIdx(i);
                      setStageIdx(0);
                    }}
                    onClick={() => {
                      setBoardIdx(i);
                      setPane('stages');
                      panelRef.current?.focus();
                    }}
                    className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer ${
                      highlighted ? 'bg-slate-100 dark:bg-white/10' : ''
                    } ${focused ? 'ring-1 ring-primary-400' : ''} ${
                      b.id === boardId ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <span className="truncate">{b.name}</span>
                    <ChevronRight size={12} className="shrink-0 text-slate-400" />
                  </div>
                );
              })}
            </div>
            <div className="overflow-y-auto scrollbar-custom p-1.5">
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 truncate">
                Etapas{focusBoard ? ` de ${focusBoard.name}` : ''}
              </p>
              {focusStages.length === 0 && <p className="px-2 py-2 text-xs text-slate-400">Este funil não tem etapas.</p>}
              {focusStages.map((s, i) => {
                const current = focusBoard?.id === boardId && s.id === stageId;
                const focused = pane === 'stages' && i === stageIdx;
                const lost = focusBoard?.lostStageId === s.id || (!focusBoard?.lostStageId && s.linkedLifecycleStage === 'OTHER');
                const won = focusBoard?.wonStageId === s.id;
                return (
                  <div
                    key={s.id}
                    id={`${listId}-s-${i}`}
                    role="option"
                    aria-selected={current}
                    onMouseEnter={() => {
                      setPane('stages');
                      setStageIdx(i);
                    }}
                    onClick={() => focusBoard && choose(focusBoard, s)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer ${
                      focused ? 'bg-primary-50 dark:bg-primary-500/15' : ''
                    } ${current ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${s.color || 'bg-slate-300'}`} aria-hidden="true" />
                    <span className="truncate flex-1">{s.label}</span>
                    {won && <span className="shrink-0 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">ganho</span>}
                    {lost && <span className="shrink-0 text-[10px] font-bold text-red-500">perda</span>}
                    {current && <Check size={13} className="shrink-0 text-primary-600 dark:text-primary-400" aria-label="Etapa atual" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
