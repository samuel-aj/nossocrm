'use client';

/**
 * Camada de automação de uma coluna do Kanban (modo Automatizar): o que
 * dispara quando um lead ENTRA nesta etapa, em chips compactos, com menu
 * "..." (abrir, ativar/desativar, excluir) e "+ Automatizar".
 */
import React, { useState } from 'react';
import { Bot, ExternalLink, Pause, Play, Plus, Sparkles, Trash2, Webhook, Zap } from 'lucide-react';
import { KebabMenu, type KebabItem } from '@/components/ui/KebabMenu';
import type { StageAutomation } from './useStageAutomations';

const KIND_ICON = { bot: Bot, agent: Sparkles, webhook: Webhook } as const;
const KIND_LABEL = { bot: 'Robô', agent: 'Agente de IA', webhook: 'Webhook' } as const;
const COLLAPSED = 4;

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
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, COLLAPSED);
  const hidden = items.length - visible.length;

  return (
    <div className="flex-1 p-3 overflow-y-auto scrollbar-custom bg-slate-100/50 dark:bg-black/20 min-h-[100px] flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">
        <Zap size={12} aria-hidden="true" /> Dispara ao entrar
      </p>

      {loading ? (
        <p className="text-xs text-slate-400 py-2">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 py-1">Nenhuma automação</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((item) => {
            const Icon = KIND_ICON[item.kind];
            const menu: KebabItem[] = [
              { label: item.kind === 'webhook' ? 'Editar' : 'Abrir configuração', icon: <ExternalLink size={14} aria-hidden="true" />, onSelect: () => onOpen(item) },
              {
                label: item.enabled ? 'Desativar' : 'Ativar',
                icon: item.enabled ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />,
                onSelect: () => onToggle(item),
              },
              ...(item.kind !== 'agent'
                ? [{ label: 'Excluir', icon: <Trash2 size={14} aria-hidden="true" />, danger: true, onSelect: () => onRemove(item) }]
                : []),
            ];
            return (
              <li
                key={item.id}
                className={`group flex items-start gap-2 rounded-lg border bg-white dark:bg-dark-card px-2.5 py-2 transition-colors ${
                  item.enabled
                    ? 'border-slate-200 dark:border-white/10 hover:border-primary-300 dark:hover:border-primary-500/40'
                    : 'border-dashed border-slate-300 dark:border-white/15 opacity-70'
                }`}
              >
                <span className="mt-0.5 p-1 rounded-md bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0" title={KIND_LABEL[item.kind]}>
                  <Icon size={13} aria-hidden="true" />
                </span>
                <button type="button" onClick={() => onOpen(item)} className="flex-1 min-w-0 text-left focus-visible-ring rounded">
                  <span className="block text-xs font-semibold text-slate-900 dark:text-white truncate">{item.title}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {KIND_LABEL[item.kind]}
                    {item.subtitle ? ` · ${item.subtitle}` : ''}
                    {!item.enabled ? ' · desativado' : ''}
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

      {hidden > 0 ? (
        <button type="button" onClick={() => setExpanded(true)} className="text-[11px] font-medium text-slate-500 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-300 text-left">
          Ver mais {hidden}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onAdd}
        className="mt-auto inline-flex items-center justify-center gap-1.5 w-full rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors focus-visible-ring"
      >
        <Plus size={14} aria-hidden="true" /> {items.length === 0 ? 'Automatizar' : 'Adicionar automação'}
      </button>
    </div>
  );
}

export default StageAutomationsPanel;
