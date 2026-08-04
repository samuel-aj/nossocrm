import React, { useState } from 'react';
import { DealView, CustomFieldDefinition } from '@/types';
import { Phone, Copy, Check, Hourglass, Trophy, XCircle, Package, UserX } from 'lucide-react';
import { ActivityStatusIcon } from './ActivityStatusIcon';
import { OwnerBadge } from './OwnerBadge';
import type { DealActivityStatus } from '@/features/boards/utils/dealActivityStatus';
import { priorityAriaLabelPtBr } from '@/lib/utils/priority';

interface DealCardProps {
  deal: DealView;
  isRotting: boolean;
  activityStatus: DealActivityStatus;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, id: string, title: string) => void;
  /** Called whenever the drag session ends — including aborted/no-drop cases. */
  onDragEnd?: () => void;
  /** Callback de seleção do deal (mantido estável via useCallback no pai para permitir memoização) */
  onSelect: (dealId: string) => void;
  /**
   * Performance: boolean derivado por-card evita prop global mutável.
   * Isso reduz re-render em listas grandes quando o usuário abre/fecha o menu.
   */
  isMenuOpen: boolean;
  setOpenMenuId: (id: string | null) => void;
  onQuickAddActivity: (
    dealId: string,
    type: 'CALL' | 'MEETING' | 'EMAIL',
    dealTitle: string
  ) => void;
  customFieldDefinitions: CustomFieldDefinition[];
  setLastMouseDownDealId: (id: string | null) => void;
  /** Callback to open move-to-stage modal for keyboard accessibility */
  onMoveToStage?: (dealId: string) => void;
  /** Seleção em massa: modo explícito + card selecionado + toggle */
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (dealId: string) => void;
  /** Contato do lead está INATIVO (derivado do status do contato; só visual) */
  contactInactive: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
      title="Copiar número"
      aria-label={`Copiar ${text}`}
    >
      {copied ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
    </button>
  );
}

// Check if deal is closed (won or lost)
const isDealClosed = (deal: DealView) => deal.isWon || deal.isLost;

// Get priority label for accessibility (PT-BR)
const getPriorityLabel = (priority: string | undefined) => priorityAriaLabelPtBr(priority);

const DealCardComponent: React.FC<DealCardProps> = ({
  deal,
  isRotting,
  activityStatus,
  isDragging,
  onDragStart,
  onDragEnd,
  onSelect,
  isMenuOpen,
  setOpenMenuId,
  onQuickAddActivity,
  customFieldDefinitions,
  setLastMouseDownDealId,
  onMoveToStage,
  selectionMode,
  selected,
  onToggleSelect,
  contactInactive,
}) => {
  const [localDragging, setLocalDragging] = useState(false);
  const isClosed = isDealClosed(deal);

  const handleToggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(isMenuOpen ? null : deal.id);
  };

  const handleQuickAdd = (type: 'CALL' | 'MEETING' | 'EMAIL') => {
    onQuickAddActivity(deal.id, type, deal.title);
  };

  const handleDragStart = (e: React.DragEvent) => {
    setLocalDragging(true);
    e.dataTransfer.setData('dealId', deal.id);
    // Fallback mapping when optimistic temp id gets replaced mid-drag by a refetch.
    // Do not log title; it can contain PII.
    e.dataTransfer.setData('dealTitle', deal.title || '');
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(e, deal.id, deal.title || '');
  };

  const handleDragEnd = () => {
    setLocalDragging(false);
    // Always notify the parent so `draggingId` is cleared even when the drop
    // happens outside any stage (HTML drag-end always fires, drop does not).
    onDragEnd?.();
  };

  // Determine card styling based on won/lost status
  const getCardClasses = () => {
    const baseClasses = `
      p-3 rounded-lg border-l-4 border-y border-r
      shadow-sm cursor-grab active:cursor-grabbing group hover:shadow-md transition-all relative select-none
    `;

    if (deal.isWon) {
      return `${baseClasses} 
        bg-green-50 dark:bg-green-900/20 
        border-green-200 dark:border-green-700/50
        ${localDragging || isDragging ? 'opacity-50 rotate-2 scale-95' : ''}`;
    }

    if (deal.isLost) {
      return `${baseClasses} 
        bg-red-50 dark:bg-red-900/20 
        border-red-200 dark:border-red-700/50 
        ${localDragging || isDragging ? 'opacity-50 rotate-2 scale-95' : 'opacity-70'}`;
    }

    // Default - open deal
    return `${baseClasses}
      border-slate-200 dark:border-slate-700/50
      ${localDragging || isDragging ? 'bg-green-100 dark:bg-green-900 opacity-50 rotate-2 scale-95' : 'bg-white dark:bg-slate-800 opacity-100'}
      ${isRotting ? 'opacity-80 saturate-50 border-dashed' : ''}
    `;
  };

  // Get border-left color class based on status
  const getBorderLeftClass = () => {
    if (deal.isWon) return '!border-l-green-500';
    if (deal.isLost) return '!border-l-red-500';
    // Priority-based colors for open deals
    if (deal.priority === 'high') return '!border-l-red-500';
    if (deal.priority === 'medium') return '!border-l-amber-500';
    return '!border-l-blue-500';
  };

  // Build accessible label including visible text (tags)
  const getAriaLabel = () => {
    const parts: string[] = [];

    // Status badges (visible text)
    if (deal.isWon) parts.push('ganho');
    if (deal.isLost) parts.push('perdido');

    // Tags (visible text) - include all shown tags
    const shownTags = deal.tags.slice(0, isClosed ? 1 : 2);
    if (shownTags.length > 0) {
      parts.push(...shownTags);
    }
    const hiddenTagCount = deal.tags.length - shownTags.length;
    if (hiddenTagCount > 0) {
      parts.push(`e mais ${hiddenTagCount} tag${hiddenTagCount === 1 ? '' : 's'}`);
    }

    // Main content
    parts.push(deal.title);
    if (deal.companyName) parts.push(deal.companyName);
    parts.push(`R$ ${deal.value.toLocaleString('pt-BR')}`);

    // Additional context
    const priority = getPriorityLabel(deal.priority);
    if (priority) parts.push(priority);
    if (isRotting && !isClosed) parts.push('estagnado');
    if (contactInactive) parts.push('contato inativo');

    return parts.join(', ');
  };

  const visibleCustomFields = customFieldDefinitions.slice(0, 2);

  return (
    <div
      data-deal-id={deal.id}
      draggable={!deal.id.startsWith('temp-')}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseDown={() => setLastMouseDownDealId(deal.id)}
      onClick={e => {
        if ((e.target as HTMLElement).closest('button')) return;
        // No modo seleção, o clique no card marca/desmarca em vez de abrir.
        if (selectionMode) {
          if (!(e.target as HTMLElement).closest('label')) onToggleSelect(deal.id);
          return;
        }
        onSelect(deal.id);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!(e.target as HTMLElement).closest('button')) {
            if (selectionMode) onToggleSelect(deal.id);
            else onSelect(deal.id);
          }
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={getAriaLabel()}
      className={`${getCardClasses()} ${getBorderLeftClass()} ${selected ? 'ring-2 ring-primary-500 dark:ring-primary-400' : ''} ${contactInactive ? 'opacity-60 grayscale' : ''}`}
    >
      {/* Checkbox de seleção múltipla (só no modo "Selecionar vários"; à direita p/ não cobrir as tags) */}
      {selectionMode && (
        <label
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1.5 right-1.5 z-10 p-0.5 rounded cursor-pointer"
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(deal.id)}
            aria-label={`Selecionar ${deal.title}`}
            className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
          />
        </label>
      )}

      {/* Won Badge */}
      {deal.isWon && (
        <div
          className="absolute -top-2 -right-2 bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-200 p-1 rounded-full shadow-sm z-10 flex items-center gap-0.5"
          aria-label="Negócio ganho"
        >
          <Trophy size={12} aria-hidden="true" />
        </div>
      )}

      {/* Lost Badge */}
      {deal.isLost && (
        <div
          className="absolute -top-2 -right-2 bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-200 p-1 rounded-full shadow-sm z-10 flex items-center gap-0.5"
          aria-label={deal.lossReason ? `Perdido: ${deal.lossReason}` : 'Negócio perdido'}
        >
          <XCircle size={12} aria-hidden="true" />
        </div>
      )}

      {/* Rotting indicator - only for open deals */}
      {isRotting && !isClosed && (
        <div
          className="absolute -top-2 -right-2 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 p-1 rounded-full shadow-sm z-10"
          aria-label="Negócio estagnado, mais de 10 dias sem atualização"
        >
          <Hourglass size={12} aria-hidden="true" />
        </div>
      )}

      <div className="flex gap-1 mb-2 flex-wrap">
        {/* Won/Lost status badge */}
        {deal.isWon && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-800/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700">
            ✓ GANHO
          </span>
        )}
        {deal.isLost && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-800/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700">
            ✗ PERDIDO
          </span>
        )}
        {/* Selo automático: contato do lead está INATIVO */}
        {contactInactive && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 flex items-center gap-1">
            <UserX size={10} aria-hidden="true" /> INATIVO
          </span>
        )}
        {/* Regular tags */}
        {deal.tags.slice(0, isClosed ? 1 : 2).map((tag, index) => (
          <span
            key={`${deal.id}-tag-${index}`}
            className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/5"
          >
            {tag}
          </span>
        ))}
        {/* Indicador de tags que não couberam: passar o mouse lista todas */}
        {deal.tags.length > (isClosed ? 1 : 2) && (
          <span
            title={deal.tags.slice(isClosed ? 1 : 2).join(', ')}
            className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/5"
          >
            +{deal.tags.length - (isClosed ? 1 : 2)}
          </span>
        )}
      </div>

      <h4
        className={`text-sm font-bold font-display leading-snug mb-0.5 ${isRotting ? 'text-slate-600 dark:text-slate-400' : 'text-slate-900 dark:text-white'}`}
      >
        {deal.title}
      </h4>
      {deal.contactPhone ? (
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1">
          <Phone size={10} aria-hidden="true" />
          <span>{deal.contactPhone}</span>
          <CopyButton text={deal.contactPhone} />
        </div>
      ) : deal.companyName ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1">
          <Phone size={10} aria-hidden="true" /> {deal.contactEmail || 'Sem contato'}
        </p>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1">
          <Phone size={10} aria-hidden="true" /> {deal.contactEmail || 'Sem contato'}
        </p>
      )}

      {visibleCustomFields.length > 0 && (
        <div className="mb-3 space-y-1">
          {visibleCustomFields.map((field) => (
            <div key={`${deal.id}-${field.id}`} className="text-sm">
              <span className="text-slate-500">{field.label}: </span>
              {(() => {
                const value = deal.customFields?.[field.key];
                if (value === undefined || value === null || String(value).trim() === '') {
                  return (
                    <span className="italic text-slate-500 dark:text-slate-400">
                      Campo vazio
                    </span>
                  );
                }
                return <span className="text-slate-900 dark:text-white">{String(value)}</span>;
              })()}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-white/5">
        <div className="flex items-center gap-2">
          <OwnerBadge ownerId={deal.ownerId} />
          {deal.items && deal.items.length > 0 ? (
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1 min-w-0" title={`${deal.items[0].name} — R$ ${deal.items[0].price.toLocaleString('pt-BR')}`}>
              <Package size={11} aria-hidden="true" className="flex-shrink-0 text-primary-500" />
              <span className="truncate">{deal.items[0].name}</span>
            </span>
          ) : (
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 font-mono">
              ${deal.value.toLocaleString()}
            </span>
          )}
        </div>

        <div className="flex items-center">
          <ActivityStatusIcon
            status={activityStatus}
            dealId={deal.id}
            dealTitle={deal.title}
            isOpen={isMenuOpen}
            onToggle={handleToggleMenu}
            onOpenSchedule={handleQuickAdd}
            onRequestClose={() => setOpenMenuId(null)}
            onMoveToStage={onMoveToStage ? () => onMoveToStage(deal.id) : undefined}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * Performance: `DealCard` fica em lista grande (Kanban).
 * Usamos `React.memo` para evitar re-render de TODOS os cards quando apenas o menu de 1 deal muda.
 * Isso depende de props estáveis do pai (ex.: `onSelect` via useCallback e `isMenuOpen` por-card).
 */
export const DealCard = React.memo(DealCardComponent);
