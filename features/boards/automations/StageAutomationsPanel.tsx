'use client';

/**
 * Conteúdo de uma coluna do Kanban no modo Automatizar: no lugar dos leads,
 * as automações que disparam quando um lead ENTRA na etapa, cada uma como um
 * card da coluna (ícone, nome, resumo, momento/entrada/condições, menu "..."),
 * arrastável para outra etapa, e um card tracejado para adicionar.
 */
import React from 'react';
import { Bot, ExternalLink, Pause, Pencil, Play, Plus, Sparkles, Trash2, Webhook, Zap, MessageCircle, Tag, MoveRight, Workflow, GripVertical } from 'lucide-react';
import { KebabMenu, type KebabItem } from '@/components/ui/KebabMenu';
import type { StageAutomation } from './useStageAutomations';
import { stageActionStep } from './stageAutomationModel';

const KIND_LABEL = { action: 'Ação da etapa', bot: 'Robô', agent: 'Agente de IA', webhook: 'Webhook' } as const;

function iconFor(item: StageAutomation) {
  if (item.kind === 'action' && item.bot) {
    const step = stageActionStep(item.bot);
    if (step?.type === 'send_text') return MessageCircle;
    if (step?.type === 'add_tag') return Tag;
    if (step?.type === 'move_stage') return MoveRight;
    if (step?.type === 'handoff_agent') return Sparkles;
    if (step?.type === 'webhook') return Webhook;
    if (step?.type === 'start_bot') return Workflow;
  }
  if (item.kind === 'agent') return Sparkles;
  if (item.kind === 'webhook') return Webhook;
  return Bot;
}

export const AUTOMATION_DRAG_TYPE = 'automationId';

export function StageAutomationsPanel({
  items,
  loading,
  onAdd,
  onOpen,
  onToggle,
  onRemove,
  draggingItemId,
  dropActive,
  onDragStart,
  onDragEnd,
}: {
  items: StageAutomation[];
  loading: boolean;
  onAdd: () => void;
  onOpen: (item: StageAutomation) => void;
  onToggle: (item: StageAutomation) => void;
  onRemove: (item: StageAutomation) => void;
  /** Card sendo arrastado (fica esmaecido na origem) */
  draggingItemId?: string | null;
  /** Esta coluna é o destino do arraste: mostra onde o card vai cair */
  dropActive?: boolean;
  onDragStart?: (item: StageAutomation) => void;
  onDragEnd?: () => void;
}) {
  return (
    <div className="space-y-2" aria-label="Automações ao entrar na etapa">
      <p className="flex items-center gap-1.5 px-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">
        <Zap size={11} className="fill-current" aria-hidden="true" /> Dispara ao entrar
      </p>

      {loading ? (
        <p className="px-1 py-3 text-xs text-slate-400">Carregando...</p>
      ) : items.length === 0 && !dropActive ? (
        <p className="px-1 py-2 text-xs text-slate-500 dark:text-slate-400">Sem automações nesta etapa</p>
      ) : (
        items.map((item) => {
          const Icon = iconFor(item);
          const openLabel = item.kind === 'bot' ? 'Abrir robô' : 'Editar';
          const dragging = draggingItemId === item.id;
          const menu: KebabItem[] = [
            {
              label: openLabel,
              icon: item.kind === 'bot' ? <ExternalLink size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />,
              onSelect: () => onOpen(item),
            },
            {
              label: item.enabled ? 'Desativar' : 'Ativar',
              icon: item.enabled ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />,
              onSelect: () => onToggle(item),
            },
            {
              label: item.kind === 'agent' ? 'Remover desta etapa' : 'Excluir',
              icon: <Trash2 size={14} aria-hidden="true" />,
              danger: true,
              onSelect: () => onRemove(item),
            },
          ];
          return (
            <article
              key={item.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(AUTOMATION_DRAG_TYPE, item.id);
                e.dataTransfer.effectAllowed = 'move';
                onDragStart?.(item);
              }}
              onDragEnd={() => onDragEnd?.()}
              title="Arraste para outra etapa"
              className={`group relative rounded-xl border bg-white dark:bg-dark-card p-3 shadow-sm transition-all hover:shadow-md hover:border-primary-300 dark:hover:border-primary-500/40 cursor-grab active:cursor-grabbing ${
                dragging ? 'opacity-40 scale-[0.98]' : ''
              } ${item.enabled ? 'border-slate-200 dark:border-white/10' : 'border-dashed border-slate-300 dark:border-white/15 opacity-70'}`}
            >
              <div className="flex items-start gap-2">
                <GripVertical size={14} className="mt-1 -ml-1 text-slate-300 dark:text-slate-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                <span className="mt-0.5 p-1.5 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0" title={KIND_LABEL[item.kind]}>
                  <Icon size={14} aria-hidden="true" />
                </span>
                <button type="button" onClick={() => onOpen(item)} className="flex-1 min-w-0 text-left rounded focus-visible-ring" title={openLabel}>
                  <span className="block text-sm font-semibold leading-snug text-slate-900 dark:text-white line-clamp-2">{item.title}</span>
                  <span className="block mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400 line-clamp-2">{item.subtitle}</span>
                </button>
                <KebabMenu
                  label={`Mais ações: ${item.title}`}
                  size={15}
                  className="-mr-1 -mt-1 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
                  items={menu}
                />
              </div>
              <div className="mt-2 pl-1 space-y-0.5">
                <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">{item.when}</p>
                {item.conditions ? (
                  <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 truncate" title={item.conditions}>
                    Somente se {item.conditions}
                  </p>
                ) : null}
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
                  <span className={`w-1.5 h-1.5 rounded-full ${item.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
                  <span className={item.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>{item.enabled ? 'Ativa' : 'Desativada'}</span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-slate-400 dark:text-slate-500">{KIND_LABEL[item.kind]}</span>
                </p>
              </div>
            </article>
          );
        })
      )}

      {dropActive ? (
        <div className="rounded-xl border-2 border-dashed border-primary-400 dark:border-primary-500/60 bg-primary-50/60 dark:bg-primary-500/10 px-3 py-4 text-center text-xs font-semibold text-primary-700 dark:text-primary-300 animate-pulse pointer-events-none">
          Soltar aqui: passa a disparar nesta etapa
        </div>
      ) : null}

      <button
        type="button"
        onClick={onAdd}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/15 px-3 py-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-primary-400 hover:text-primary-700 dark:hover:border-primary-500/60 dark:hover:text-primary-300 hover:bg-primary-50/50 dark:hover:bg-primary-500/5 transition-colors focus-visible-ring"
      >
        <Plus size={14} aria-hidden="true" /> {items.length === 0 ? 'Automatizar esta etapa' : 'Adicionar automação'}
      </button>
    </div>
  );
}

export default StageAutomationsPanel;
