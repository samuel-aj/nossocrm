import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { DealView, CustomFieldDefinition, BoardStage } from '@/types';
import { ActivityStatusIcon } from './ActivityStatusIcon';
import { OwnerBadge } from './OwnerBadge';
import { FocusTrap } from '@/lib/a11y/components/FocusTrap';
import type { DealActivityStatus } from '@/features/boards/utils/dealActivityStatus';

// Shared default for cards with no pending activities — same reference on
// every render so React.memo on KanbanListRow can skip re-renders.
export const NO_ACTIVITY_STATUS: DealActivityStatus = { kind: 'none', daysFromToday: 0, daysOverdue: 0 };

type QuickAddType = 'CALL' | 'MEETING' | 'EMAIL';

/** Data de criação em partes (fuso local): empilhadas na célula, cabem na
 *  coluna estreita sem vazar por cima das colunas vizinhas (table-fixed). */
const formatCreatedParts = (iso: string): { date: string; time: string } | null => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString('pt-BR'),
    time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
};

/**
 * Posiciona um menu flutuante (React Portal) ancorado num botão-gatilho,
 * igual ao dropdown de agendar atividade (`ActivityStatusIcon`): nunca
 * clipa dentro do container com scroll da tabela, fecha ao clicar fora ou
 * apertar Esc, e reposiciona em resize/scroll.
 */
function useAnchoredMenu(open: boolean, onClose: () => void) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const MENU_WIDTH = 220;
    const MENU_MAX_HEIGHT = 280;
    const GAP = 4;
    const place = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();

      let left = rect.left;
      if (left + MENU_WIDTH > window.innerWidth - 8) left = window.innerWidth - 8 - MENU_WIDTH;
      if (left < 8) left = 8;

      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < MENU_MAX_HEIGHT + GAP;
      const top = openUpward ? rect.top - MENU_MAX_HEIGHT - GAP : rect.bottom + GAP;

      setPos({ top: Math.max(8, top), left });
    };
    place();

    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  return { triggerRef, menuRef, pos };
}

type KanbanListRowProps = {
  deal: DealView;
  stageLabel: string;
  stages: BoardStage[];
  customFieldDefinitions: CustomFieldDefinition[];
  activityStatus: DealActivityStatus;
  isMenuOpen: boolean;
  /** Classe bg-* da etapa: filete à esquerda ligando a linha ao grupo dela. */
  accentColor?: string;
  onSelect: (dealId: string) => void;
  onToggleMenu: (e: React.MouseEvent, dealId: string) => void;
  onQuickAdd: (dealId: string, type: QuickAddType, dealTitle: string) => void;
  onCloseMenu: () => void;
  onMoveDealToStage?: (dealId: string, newStageId: string) => void;
  /** Estado do dropdown de estágio erguido pro pai (QualificationView): só
   *  um aberto por vez, igual ao menu de atividade — ver comentário lá. */
  isStageMenuOpen: boolean;
  onToggleStageMenu: (dealId: string) => void;
  onCloseStageMenu: () => void;
};

/**
 * Linha da lista de deals (usada pela QualificationView em todas as abas).
 * Performance: tabela pode ter muitas linhas.
 * `React.memo` + `isMenuOpen` por-linha evita re-render em massa ao alternar o menu.
 */
export const KanbanListRow = React.memo(function KanbanListRow({
  deal,
  stageLabel,
  stages,
  customFieldDefinitions,
  activityStatus,
  isMenuOpen,
  accentColor,
  onSelect,
  onToggleMenu,
  onQuickAdd,
  onCloseMenu,
  onMoveDealToStage,
  isStageMenuOpen,
  onToggleStageMenu,
  onCloseStageMenu,
}: KanbanListRowProps) {
  const { triggerRef: stageTriggerRef, menuRef: stageMenuRef, pos: stageMenuPos } = useAnchoredMenu(
    isStageMenuOpen,
    onCloseStageMenu
  );
  const created = formatCreatedParts(deal.createdAt);

  const stageBadgeClasses = deal.isWon
    ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300'
    : deal.isLost
      ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

  return (
      <tr
        onClick={() => onSelect(deal.id)}
        className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors cursor-pointer group"
      >
        <td className="relative px-6 py-3 text-center">
        {accentColor ? (
          <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${accentColor}`} />
        ) : null}
        <ActivityStatusIcon
          status={activityStatus}
          dealId={deal.id}
          dealTitle={deal.title}
          isOpen={isMenuOpen}
          onToggle={(e) => onToggleMenu(e, deal.id)}
          onOpenSchedule={(type) => onQuickAdd(deal.id, type, deal.title)}
          onRequestClose={onCloseMenu}
        />
        </td>
        <td className="px-6 py-3 font-bold text-slate-900 dark:text-white">{deal.title}</td>
        <td className="px-6 py-3">
          {deal.tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {deal.tags.slice(0, 2).map((tag, index) => (
                <span
                  key={`${deal.id}-tag-${index}`}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/5"
                >
                  {tag}
                </span>
              ))}
              {deal.tags.length > 2 && (
                <span
                  title={deal.tags.slice(2).join(', ')}
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/5"
                >
                  +{deal.tags.length - 2}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-300 dark:text-slate-600">-</span>
          )}
        </td>
        <td className="px-6 py-3">
          {onMoveDealToStage ? (
            <>
              <button
                ref={stageTriggerRef}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStageMenu(deal.id);
                }}
                aria-haspopup="listbox"
                aria-expanded={isStageMenuOpen}
                aria-label="Mudar estágio"
                title="Mudar estágio"
                className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded focus-visible-ring ${
                  !deal.isWon && !deal.isLost
                    ? `${stageBadgeClasses} hover:bg-slate-200 dark:hover:bg-slate-700`
                    : stageBadgeClasses
                }`}
              >
                {stageLabel}
                <ChevronDown
                  size={12}
                  aria-hidden="true"
                  className={`transition-transform ${isStageMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isStageMenuOpen && stageMenuPos && typeof document !== 'undefined'
                ? createPortal(
                    <FocusTrap
                      active={isStageMenuOpen}
                      onEscape={onCloseStageMenu}
                      initialFocus={`#stage-opt-${deal.id}-${deal.status}`}
                      returnFocus
                    >
                      <div
                        ref={stageMenuRef}
                        role="listbox"
                        aria-label="Estágios disponíveis"
                        style={{ position: 'fixed', top: stageMenuPos.top, left: stageMenuPos.left, width: 220 }}
                        className="z-[9999] max-h-[280px] overflow-y-auto scrollbar-custom bg-white dark:bg-slate-800 rounded-lg shadow-2xl ring-1 ring-slate-200 dark:ring-white/10 p-1 animate-in fade-in zoom-in-95 duration-100"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {stages.map((stage) => (
                          <button
                            key={stage.id}
                            id={`stage-opt-${deal.id}-${stage.id}`}
                            type="button"
                            role="option"
                            aria-selected={stage.id === deal.status}
                            onClick={() => {
                              if (stage.id !== deal.status) onMoveDealToStage(deal.id, stage.id);
                              onCloseStageMenu();
                            }}
                            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-sm focus-visible-ring hover:bg-slate-100 dark:hover:bg-white/10 ${
                              stage.id === deal.status
                                ? 'bg-primary-500/10 text-primary-600 dark:text-primary-300'
                                : 'text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${stage.color || 'bg-slate-500'}`}
                            />
                            <span className="truncate flex-1">{stage.label}</span>
                            {stage.id === deal.status && <Check size={14} className="shrink-0" aria-hidden="true" />}
                          </button>
                        ))}
                      </div>
                    </FocusTrap>,
                    document.body
                  )
                : null}
            </>
          ) : (
            <span className={`text-xs font-bold px-2 py-1 rounded ${stageBadgeClasses}`}>{stageLabel}</span>
          )}
        </td>
        <td className="px-6 py-3 font-mono text-slate-700 dark:text-slate-200">
          ${deal.value.toLocaleString()}
        </td>
        <td className="px-6 py-3">
          <div className="flex items-center gap-2">
            <OwnerBadge ownerId={deal.ownerId} showName />
          </div>
        </td>
        <td className="px-3 py-3 text-slate-500 dark:text-slate-400 text-xs">
          {created ? (
            <>
              <span className="block whitespace-nowrap">{created.date}</span>
              <span className="block whitespace-nowrap">{created.time}</span>
            </>
          ) : (
            '-'
          )}
        </td>
        {/* Custom Fields Cells */}
        {customFieldDefinitions.map((field) => (
          <td key={field.id} className="px-6 py-3 text-right text-slate-600 dark:text-slate-300 text-sm">
            {deal.customFields?.[field.key] || '-'}
          </td>
        ))}
      </tr>
  );
});
