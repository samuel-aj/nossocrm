'use client';

/**
 * Etapas do board: lista compacta, arrastar pela alça para reordenar (com a
 * linha de onde vai cair), nome editado na própria linha, cor num seletor de
 * bolinhas, e o resto (estágio do contato, ID para integrações) ao expandir
 * a etapa. Ações secundárias no menu "...". Sem mudar a lógica do board: o
 * componente só edita a lista `stages` que o modal já mantinha.
 */
import React, { useRef, useState } from 'react';
import { Check, ChevronDown, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import { KebabMenu } from '@/components/ui/KebabMenu';
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

export function BoardStagesEditor({
  stages,
  onChange,
  lifecycleStages,
  showIds,
  onManageLifecycle,
}: {
  stages: BoardStage[];
  onChange: (stages: BoardStage[]) => void;
  lifecycleStages: LifecycleStage[];
  /** Board existente: mostra o ID de cada etapa (to_stage_id da API/n8n) */
  showIds: boolean;
  onManageLifecycle?: () => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const armed = useRef(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const update = (id: string, patch: Partial<BoardStage>) => onChange(stages.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => {
    if (stages.length <= MIN_STAGES) return;
    onChange(stages.filter((s) => s.id !== id));
    if (expanded === id) setExpanded(null);
  };
  const add = () => {
    const id = crypto.randomUUID();
    onChange([...stages, { id, label: `Etapa ${stages.length + 1}`, color: STAGE_COLORS[stages.length % STAGE_COLORS.length] }]);
    window.setTimeout(() => {
      const el = inputs.current[id];
      el?.focus();
      el?.select();
    }, 0);
  };
  const duplicate = (s: BoardStage, index: number) => {
    const next = [...stages];
    next.splice(index + 1, 0, { ...s, id: crypto.randomUUID(), label: `${s.label} (cópia)` });
    onChange(next);
  };
  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      // sem permissão: o id continua visível na linha
    }
  };

  const finishDrag = () => {
    setDragging(null);
    setDropIndex(null);
    armed.current = false;
  };
  const drop = () => {
    if (!dragging || dropIndex === null) return finishDrag();
    const from = stages.findIndex((s) => s.id === dragging);
    const next = [...stages];
    const [moved] = next.splice(from, 1);
    let to = dropIndex;
    if (from < to) to -= 1;
    next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
    onChange(next);
    finishDrag();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Etapas</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Arraste pela alça para mudar a ordem. Clique na etapa para as opções.</p>
        </div>
        <span className="text-xs text-slate-400">{stages.length} etapas</span>
      </div>

      <ul className="rounded-xl border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5 overflow-hidden" aria-label="Etapas do board">
        {stages.map((stage, index) => {
          const open = expanded === stage.id;
          const lifecycle = lifecycleStages.find((l) => l.id === stage.linkedLifecycleStage);
          const isOver = dragging && dragging !== stage.id && dropIndex === index;
          return (
            <li
              key={stage.id}
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
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const idx = e.clientY > rect.top + rect.height / 2 ? index + 1 : index;
                if (idx !== dropIndex) setDropIndex(idx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop();
              }}
              onDragEnd={finishDrag}
              className={`relative bg-white dark:bg-white/[0.02] transition-colors ${dragging === stage.id ? 'opacity-40' : ''}`}
            >
              {isOver ? <span className="absolute left-3 right-3 top-0 h-0.5 rounded-full bg-primary-500 z-10" aria-hidden="true" /> : null}
              {dragging && dragging !== stage.id && dropIndex === index + 1 && index === stages.length - 1 ? (
                <span className="absolute left-3 right-3 bottom-0 h-0.5 rounded-full bg-primary-500 z-10" aria-hidden="true" />
              ) : null}
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  aria-label={`Reordenar etapa ${stage.label}`}
                  title="Arraste para reordenar"
                  onPointerDown={() => {
                    armed.current = true;
                  }}
                  onPointerUp={() => {
                    armed.current = false;
                  }}
                  className="shrink-0 p-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-300"
                >
                  <GripVertical size={16} aria-hidden="true" />
                </button>

                {/* Cor */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label={`Cor da etapa ${stage.label}`}
                    title="Trocar a cor"
                    onClick={() => setColorFor(colorFor === stage.id ? null : stage.id)}
                    className={`h-4 w-4 rounded-full ${stage.color} ring-2 ring-white dark:ring-slate-900 shadow-sm hover:scale-110 transition-transform`}
                  />
                  {colorFor === stage.id ? (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setColorFor(null)} aria-hidden="true" />
                      <div className="absolute left-0 top-6 z-40 flex gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-2 shadow-xl">
                        {STAGE_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={c.replace('bg-', '').replace('-500', '')}
                            onClick={() => {
                              update(stage.id, { color: c });
                              setColorFor(null);
                            }}
                            className={`h-5 w-5 rounded-full ${c} ${c === stage.color ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900' : ''}`}
                          />
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>

                {/* Nome (edição na linha) */}
                <input
                  ref={(el) => {
                    inputs.current[stage.id] = el;
                  }}
                  type="text"
                  value={stage.label}
                  onChange={(e) => update(stage.id, { label: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      add();
                    }
                  }}
                  placeholder="Nome da etapa"
                  aria-label={`Nome da etapa ${index + 1}`}
                  className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-sm font-medium text-slate-900 dark:text-white rounded-md border border-transparent hover:border-slate-200 dark:hover:border-white/10 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 outline-none transition-colors"
                />

                {lifecycle ? (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-2 py-0.5 text-[11px] font-medium text-primary-700 dark:text-primary-300 shrink-0" title="Promove o contato para este estágio">
                    <span className={`h-1.5 w-1.5 rounded-full ${lifecycle.color}`} aria-hidden="true" />
                    {lifecycle.name}
                  </span>
                ) : null}

                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={open ? 'Fechar opções da etapa' : 'Abrir opções da etapa'}
                  onClick={() => setExpanded(open ? null : stage.id)}
                  className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
                >
                  <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                <KebabMenu
                  label={`Mais ações: ${stage.label}`}
                  items={[
                    { label: 'Duplicar etapa', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => duplicate(stage, index) },
                    ...(showIds
                      ? [{ label: 'Copiar ID da etapa', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void copyId(stage.id) }]
                      : []),
                    {
                      label: 'Remover etapa',
                      icon: <Trash2 size={14} aria-hidden="true" />,
                      danger: true,
                      disabled: stages.length <= MIN_STAGES,
                      onSelect: () => remove(stage.id),
                    },
                  ]}
                />
              </div>

              {open ? (
                <div className="px-4 pb-3 pt-1 ml-8 space-y-3 border-t border-slate-100 dark:border-white/5">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end pt-3">
                    <div>
                      <label htmlFor={`stage-${stage.id}-lifecycle`} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Ao entrar nesta etapa, promover o contato para
                      </label>
                      <select
                        id={`stage-${stage.id}-lifecycle`}
                        value={stage.linkedLifecycleStage || ''}
                        onChange={(e) => update(stage.id, { linkedLifecycleStage: e.target.value || undefined })}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
                      >
                        <option value="">Sem automação</option>
                        {lifecycleStages.map((ls) => (
                          <option key={ls.id} value={ls.id}>
                            {ls.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {onManageLifecycle ? (
                      <button
                        type="button"
                        onClick={onManageLifecycle}
                        className="text-xs font-medium text-slate-500 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-300 transition-colors pb-2"
                      >
                        Gerenciar estágios
                      </button>
                    ) : null}
                  </div>
                  {showIds ? (
                    <button
                      type="button"
                      onClick={() => void copyId(stage.id)}
                      title="Copiar ID da etapa (to_stage_id na API e no n8n)"
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-100 dark:bg-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                    >
                      {copied === stage.id ? <Check size={12} className="text-green-600" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                      <span className="truncate">{copied === stage.id ? 'ID copiado' : `ID ${stage.id}`}</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={add}
        className="mt-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-primary-700 dark:text-primary-300 hover:bg-primary-500/10 transition-colors focus-visible-ring"
      >
        <Plus size={15} aria-hidden="true" /> Nova etapa
      </button>
    </div>
  );
}

export default BoardStagesEditor;
