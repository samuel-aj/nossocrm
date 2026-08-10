import React, { useState } from 'react';
import { DealView, CustomFieldDefinition, BoardStage } from '@/types';
import { ActivityStatusIcon } from './ActivityStatusIcon';
import { OwnerBadge } from './OwnerBadge';
import { MoveToStageModal } from '../Modals/MoveToStageModal';
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
}: KanbanListRowProps) {
  const [moveToStageOpen, setMoveToStageOpen] = useState(false);
  const created = formatCreatedParts(deal.createdAt);

  return (
    <>
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
        <td className="px-6 py-3 text-slate-600 dark:text-slate-300">{deal.companyName}</td>
        <td className="px-6 py-3">
          {onMoveDealToStage ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMoveToStageOpen(true);
              }}
              className={`text-xs font-bold px-2 py-1 rounded focus-visible-ring ${
                deal.isWon
                  ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300'
                  : deal.isLost
                    ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
              aria-label="Mover estágio"
              title="Mover estágio"
            >
              {stageLabel}
            </button>
          ) : (
            <span
              className={`text-xs font-bold px-2 py-1 rounded ${
                deal.isWon
                  ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300'
                  : deal.isLost
                    ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              } `}
            >
              {stageLabel}
            </span>
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

      {onMoveDealToStage && moveToStageOpen ? (
        <MoveToStageModal
          isOpen={moveToStageOpen}
          onClose={() => setMoveToStageOpen(false)}
          onMove={(dealId, newStageId) => {
            onMoveDealToStage(dealId, newStageId);
            setMoveToStageOpen(false);
          }}
          deal={deal}
          stages={stages}
          currentStageId={deal.status}
        />
      ) : null}
    </>
  );
});
