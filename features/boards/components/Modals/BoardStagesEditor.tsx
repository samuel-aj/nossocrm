'use client';

/**
 * Etapas do board como um pipeline HORIZONTAL (a mesma lógica visual do
 * Kanban): cartões compactos (cor, posição, nome, alça e menu "..."), arrasto
 * horizontal com linha de destino e rolagem automática perto das bordas, para
 * levar uma etapa de uma ponta à outra num movimento só. Clicar na etapa abre
 * as configurações completas dela (nome, cor, estágio do contato, ID) num
 * modal por cima. O componente só edita a lista `stages` que o modal do board
 * já mantinha; a lógica do board não muda.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftToLine, ArrowRightToLine, Copy, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { CopyId } from '@/components/ui/CopyId';
import { KebabMenu } from '@/components/ui/KebabMenu';
import { Modal } from '@/components/ui/Modal';
import type { BoardStage, LifecycleStage } from '@/types';

export const STAGE_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
];

const MIN_STAGES = 2;
/** Faixa (px) junto das bordas em que o arrasto rola a lista sozinho */
const EDGE = 72;
const SCROLL_STEP = 14;

export function BoardStagesEditor({
  stages,
  onChange,
  lifecycleStages,
  showIds,
  onManageLifecycle,
  onStageModalOpenChange,
}: {
  stages: BoardStage[];
  onChange: (stages: BoardStage[]) => void;
  lifecycleStages: LifecycleStage[];
  /** Board existente: as etapas já têm ID de verdade (para integrações) */
  showIds: boolean;
  onManageLifecycle?: () => void;
  /** Avisa o modal pai quando o modal da etapa abre (para soltar o foco preso) */
  onStageModalOpenChange?: (open: boolean) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const armed = useRef(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const scrollDir = useRef<0 | -1 | 1>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    onStageModalOpenChange?.(editing !== null);
  }, [editing, onStageModalOpenChange]);

  // Rolagem automática enquanto arrasta perto das bordas
  useEffect(() => {
    if (!dragging) return;
    const tick = () => {
      const el = stripRef.current;
      if (el && scrollDir.current !== 0) el.scrollLeft += scrollDir.current * SCROLL_STEP;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      scrollDir.current = 0;
    };
  }, [dragging]);

  const update = (id: string, patch: Partial<BoardStage>) => onChange(stages.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= stages.length || to >= stages.length) return;
    const next = [...stages];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const remove = (id: string) => {
    if (stages.length <= MIN_STAGES) return;
    onChange(stages.filter((s) => s.id !== id));
    if (editing === id) setEditing(null);
  };
  const add = () => {
    const id = crypto.randomUUID();
    onChange([...stages, { id, label: `Etapa ${stages.length + 1}`, color: STAGE_COLORS[stages.length % STAGE_COLORS.length] }]);
    setEditing(id);
    window.setTimeout(() => stripRef.current?.scrollTo({ left: stripRef.current.scrollWidth, behavior: 'smooth' }), 0);
  };
  const duplicate = (s: BoardStage, index: number) => {
    const next = [...stages];
    next.splice(index + 1, 0, { ...s, id: crypto.randomUUID(), label: `${s.label} (cópia)` });
    onChange(next);
  };

  const finishDrag = () => {
    setDragging(null);
    setDropIndex(null);
    armed.current = false;
    scrollDir.current = 0;
  };
  const drop = () => {
    if (!dragging || dropIndex === null) return finishDrag();
    const from = stages.findIndex((s) => s.id === dragging);
    let to = dropIndex;
    if (from < to) to -= 1;
    finishDrag();
    move(from, Math.max(0, Math.min(to, stages.length - 1)));
  };
  const updateEdgeScroll = (clientX: number) => {
    const el = stripRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left + EDGE) scrollDir.current = -1;
    else if (clientX > rect.right - EDGE) scrollDir.current = 1;
    else scrollDir.current = 0;
  };

  const current = editing ? stages.find((s) => s.id === editing) ?? null : null;
  const currentIndex = current ? stages.findIndex((s) => s.id === current.id) : -1;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Etapas do pipeline</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Arraste pela alça para reordenar. Clique numa etapa para editar nome, cor e automações.
          </p>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white shadow-sm transition-colors focus-visible-ring"
        >
          <Plus size={15} aria-hidden="true" /> Nova etapa
        </button>
      </div>

      <div
        ref={stripRef}
        className="flex items-stretch gap-3 overflow-x-auto scrollbar-custom pb-3 pt-1 px-1 -mx-1 scroll-smooth"
        onDragOver={(e) => {
          if (!dragging) return;
          e.preventDefault();
          updateEdgeScroll(e.clientX);
          // Solto na área vazia à direita: vai para o fim
          if (e.target === e.currentTarget) setDropIndex(stages.length);
        }}
        onDrop={(e) => {
          if (!dragging) return;
          e.preventDefault();
          drop();
        }}
        aria-label="Etapas do board"
      >
        {stages.map((stage, index) => {
          const lifecycle = lifecycleStages.find((l) => l.id === stage.linkedLifecycleStage);
          const showBefore = dragging && dragging !== stage.id && dropIndex === index;
          const showAfter = dragging && dragging !== stage.id && dropIndex === index + 1 && index === stages.length - 1;
          return (
            <React.Fragment key={stage.id}>
              {showBefore ? <span className="w-0.5 shrink-0 self-stretch rounded-full bg-primary-500" aria-hidden="true" /> : null}
              <div
                draggable
                onDragStart={(e) => {
                  if (!armed.current) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/stage-id', stage.id);
                  setDragging(stage.id);
                }}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  updateEdgeScroll(e.clientX);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const idx = e.clientX > rect.left + rect.width / 2 ? index + 1 : index;
                  if (idx !== dropIndex) setDropIndex(idx);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  drop();
                }}
                onDragEnd={finishDrag}
                className={`group relative w-52 shrink-0 rounded-xl border bg-white dark:bg-white/[0.03] transition-all ${
                  dragging === stage.id
                    ? 'opacity-40 border-primary-300'
                    : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 hover:shadow-sm'
                }`}
              >
                <div className={`h-1.5 rounded-t-xl ${stage.color}`} aria-hidden="true" />
                <div className="flex items-center gap-1 px-2 pt-2 pb-1">
                  <button
                    type="button"
                    aria-label={`Arrastar etapa ${stage.label}`}
                    title="Arraste para reordenar"
                    onPointerDown={() => {
                      armed.current = true;
                    }}
                    onPointerUp={() => {
                      armed.current = false;
                    }}
                    className="shrink-0 p-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-300"
                  >
                    <GripVertical size={15} aria-hidden="true" />
                  </button>
                  <span className="text-[11px] font-semibold text-slate-400 tabular-nums">{index + 1}</span>
                  <span className="flex-1" />
                  <KebabMenu
                    label={`Mais ações: ${stage.label}`}
                    size={15}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
                    items={[
                      { label: 'Editar etapa', icon: <Pencil size={14} aria-hidden="true" />, onSelect: () => setEditing(stage.id) },
                      { label: 'Mover para o início', icon: <ArrowLeftToLine size={14} aria-hidden="true" />, disabled: index === 0, onSelect: () => move(index, 0) },
                      { label: 'Mover para o fim', icon: <ArrowRightToLine size={14} aria-hidden="true" />, disabled: index === stages.length - 1, onSelect: () => move(index, stages.length - 1) },
                      { label: 'Duplicar', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => duplicate(stage, index) },
                      {
                        label: 'Remover',
                        icon: <Trash2 size={14} aria-hidden="true" />,
                        danger: true,
                        disabled: stages.length <= MIN_STAGES,
                        onSelect: () => remove(stage.id),
                      },
                    ]}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(stage.id)}
                  className="block w-full text-left px-3 pb-3 pt-0.5 rounded-b-xl focus-visible-ring"
                  aria-label={`Editar etapa ${stage.label}`}
                >
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">{stage.label || 'Sem nome'}</span>
                  <span className="block text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                    {lifecycle ? `Promove para ${lifecycle.name}` : 'Sem automação'}
                  </span>
                </button>
              </div>
              {showAfter ? <span className="w-0.5 shrink-0 self-stretch rounded-full bg-primary-500" aria-hidden="true" /> : null}
            </React.Fragment>
          );
        })}
        <button
          type="button"
          onClick={add}
          className="w-40 shrink-0 rounded-xl border border-dashed border-slate-300 dark:border-white/15 text-sm text-slate-500 dark:text-slate-400 hover:border-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors flex flex-col items-center justify-center gap-1 py-6 focus-visible-ring"
        >
          <Plus size={18} aria-hidden="true" />
          Nova etapa
        </button>
      </div>

      {/* Configurações da etapa */}
      <Modal isOpen={current !== null} onClose={() => setEditing(null)} title={current ? `Etapa ${currentIndex + 1}` : 'Etapa'} size="md">
        {current ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="stage-label" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nome da etapa
              </label>
              <input
                id="stage-label"
                autoFocus
                type="text"
                value={current.label}
                onChange={(e) => update(current.id, { label: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setEditing(null);
                  }
                }}
                placeholder="Nome da etapa"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cor</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor da etapa">
                {STAGE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={c === current.color}
                    aria-label={c.replace('bg-', '').replace('-500', '')}
                    onClick={() => update(current.id, { color: c })}
                    className={`h-7 w-7 rounded-full ${c} transition-transform hover:scale-110 ${
                      c === current.color ? 'ring-2 ring-offset-2 ring-slate-500 dark:ring-offset-slate-900' : ''
                    }`}
                  />
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="stage-lifecycle" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Ao entrar nesta etapa, promover o contato para
              </label>
              <select
                id="stage-lifecycle"
                value={current.linkedLifecycleStage || ''}
                onChange={(e) => update(current.id, { linkedLifecycleStage: e.target.value || undefined })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
              >
                <option value="">Sem automação</option>
                {lifecycleStages.map((ls) => (
                  <option key={ls.id} value={ls.id}>
                    {ls.name}
                  </option>
                ))}
              </select>
              {onManageLifecycle ? (
                <button
                  type="button"
                  onClick={onManageLifecycle}
                  className="mt-1.5 text-xs font-medium text-slate-500 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-300 transition-colors"
                >
                  Gerenciar estágios do contato
                </button>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-white/5">
              <div className="flex items-center gap-2">
                {showIds ? <CopyId value={current.id} label="ID da etapa" /> : null}
                <button
                  type="button"
                  onClick={() => remove(current.id)}
                  disabled={stages.length <= MIN_STAGES}
                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  <Trash2 size={13} aria-hidden="true" /> Remover etapa
                </button>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white transition-colors focus-visible-ring"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default BoardStagesEditor;
