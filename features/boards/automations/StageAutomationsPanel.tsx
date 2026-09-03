'use client';

/**
 * Seção "Dispara ao entrar" de uma coluna do Kanban (modo Automatizar): fica
 * no TOPO do conteúdo da etapa, acima dos leads. Lista compacta das
 * automações, menu "..." (editar/abrir, ativar/desativar, excluir) e o botão
 * de adicionar logo abaixo.
 */
import React from 'react';
import { Bot, ExternalLink, Pause, Pencil, Play, Plus, Sparkles, Trash2, Webhook, Zap, MessageCircle, Tag, MoveRight } from 'lucide-react';
import { KebabMenu, type KebabItem } from '@/components/ui/KebabMenu';
import type { StageAutomation } from './useStageAutomations';
import { stageActionStep } from './stageAutomationModel';

const KIND_LABEL = { action: 'Ação', bot: 'Robô', agent: 'Agente de IA', webhook: 'Webhook' } as const;

function iconFor(item: StageAutomation) {
  if (item.kind === 'action' && item.bot) {
    const step = stageActionStep(item.bot);
    if (step?.type === 'send_text') return MessageCircle;
    if (step?.type === 'add_tag') return Tag;
    if (step?.type === 'move_stage') return MoveRight;
    if (step?.type === 'handoff_agent') return Sparkles;
  }
  if (item.kind === 'agent') return Sparkles;
  if (item.kind === 'webhook') return Webhook;
  return Bot;
}

export function StageAutomationsPanel({
  items,
  loading,
  onAdd,
  onOpen,
  onToggle,
  onRemove,
}: {
  items: StageAutomation[];
  loading: boolean;
  onAdd: () => void;
  onOpen: (item: StageAutomation) => void;
  onToggle: (item: StageAutomation) => void;
  onRemove: (item: StageAutomation) => void;
}) {
  return (
    <section
      aria-label="Automações ao entrar na etapa"
      className="rounded-lg border border-primary-200/80 dark:border-primary-500/25 bg-white dark:bg-dark-card shadow-sm overflow-hidden"
    >
      <header className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-primary-50/80 dark:bg-primary-500/10 border-b border-primary-100 dark:border-primary-500/20">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">
          <Zap size={12} className="fill-current" aria-hidden="true" /> Dispara ao entrar
        </p>
        {items.length > 0 ? (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary-600 text-white">{items.length}</span>
        ) : null}
      </header>

      {loading ? (
        <p className="px-2.5 py-2 text-[11px] text-slate-400">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="px-2.5 py-2 text-[11px] text-slate-500 dark:text-slate-400">Sem automações</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {items.map((item) => {
            const Icon = iconFor(item);
            const openLabel = item.kind === 'bot' ? 'Abrir robô' : 'Editar';
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
              <li key={item.id} className={`group flex items-start gap-2 px-2 py-1.5 ${item.enabled ? '' : 'opacity-60'}`}>
                <span className="mt-0.5 p-1 rounded-md bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0" title={KIND_LABEL[item.kind]}>
                  <Icon size={12} aria-hidden="true" />
                </span>
                <button type="button" onClick={() => onOpen(item)} className="flex-1 min-w-0 text-left rounded focus-visible-ring" title={openLabel}>
                  <span className="block text-[12px] font-semibold leading-tight text-slate-900 dark:text-white truncate">{item.title}</span>
                  <span className="block text-[11px] leading-tight text-slate-500 dark:text-slate-400 truncate">
                    {item.subtitle}
                    {!item.enabled ? ' · desativada' : ''}
                  </span>
                </button>
                <KebabMenu
                  label={`Mais ações: ${item.title}`}
                  size={14}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
                  items={menu}
                />
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={onAdd}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 border-t border-slate-100 dark:border-white/5 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors focus-visible-ring"
      >
        <Plus size={13} aria-hidden="true" /> {items.length === 0 ? 'Automatizar' : 'Adicionar automação'}
      </button>
    </section>
  );
}

export default StageAutomationsPanel;
