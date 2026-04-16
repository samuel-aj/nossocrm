import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Phone,
  Mail,
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ArrowRightLeft,
} from 'lucide-react';
import type { DealActivityStatus } from '@/features/boards/utils/dealActivityStatus';
import { ACTIVITY_STATUS_THEME } from '@/features/boards/utils/dealActivityStatus';

interface ActivityStatusIconProps {
  status: DealActivityStatus;
  dealId?: string;
  dealTitle?: string;
  isOpen: boolean;
  onToggle: (e: React.MouseEvent) => void;
  onQuickAdd: (type: 'CALL' | 'MEETING' | 'EMAIL') => void;
  onRequestClose?: () => void;
  onMoveToStage?: () => void;
}

const TYPE_ICON: Record<'CALL' | 'MEETING' | 'EMAIL' | 'TASK', React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  CALL: Phone,
  MEETING: Calendar,
  EMAIL: Mail,
  TASK: CheckCircle2,
};

/**
 * Deal activity status indicator with a quick-add menu.
 *
 * Visuals follow Pipedrive-like semantics:
 *  - none:      amber filled triangle (no follow-up planned)
 *  - overdue:   red pulsing badge with days-overdue counter
 *  - dueSoon:   orange clock (within next 24h)
 *  - scheduled: green check with type icon (follow-up on track)
 *
 * The dropdown renders through a React Portal at a fixed position anchored
 * to the button rect — this guarantees the menu is never clipped by the
 * Kanban column's overflow containers.
 */
export const ActivityStatusIcon: React.FC<ActivityStatusIconProps> = ({
  status,
  dealId,
  dealTitle: _dealTitle,
  isOpen,
  onToggle,
  onQuickAdd,
  onRequestClose,
  onMoveToStage,
}) => {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const theme = ACTIVITY_STATUS_THEME[status.kind];
  const NextIcon = status.nextActivity ? TYPE_ICON[status.nextActivity.type] : null;

  const ariaLabel = (() => {
    switch (status.kind) {
      case 'none':
        return 'Sem atividade agendada. Clique para agendar.';
      case 'overdue':
        return `Atividade atrasada há ${status.daysOverdue} ${status.daysOverdue === 1 ? 'dia' : 'dias'}. Clique para agendar outra.`;
      case 'dueSoon':
        return 'Atividade nas próximas 24h. Clique para agendar outra.';
      case 'scheduled':
        return `Atividade agendada em ${status.daysFromToday} ${status.daysFromToday === 1 ? 'dia' : 'dias'}. Clique para agendar outra.`;
      default:
        return 'Agendar atividade';
    }
  })();

  // Measure button and position menu when opened.
  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const MENU_WIDTH = 224;
      const MENU_MAX_HEIGHT = 320;
      const GAP = 8;

      // Right-align to the button, open upward if not enough room below.
      let left = rect.right - MENU_WIDTH;
      if (left < 8) left = 8;
      if (left + MENU_WIDTH > window.innerWidth - 8) {
        left = window.innerWidth - 8 - MENU_WIDTH;
      }

      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < MENU_MAX_HEIGHT + GAP;
      const top = openUpward ? rect.top - MENU_MAX_HEIGHT - GAP : rect.bottom + GAP;

      setMenuPos({ top: Math.max(8, top), left });
    };
    place();

    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // capture scrolls on ancestors too
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isOpen]);

  // Close on outside-click / escape.
  useEffect(() => {
    if (!isOpen) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      onRequestClose?.();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRequestClose?.();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, onRequestClose]);

  // Icon content per state.
  const content = (() => {
    switch (status.kind) {
      case 'none':
        return (
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center shadow-sm ring-2 ${theme.ring} ${theme.iconBg}`}
            aria-hidden="true"
          >
            <AlertTriangle size={13} strokeWidth={2.5} />
          </div>
        );
      case 'overdue':
        return (
          <div className="relative" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-red-400/60 animate-ping" />
            <div
              className={`relative w-6 h-6 rounded-full flex items-center justify-center shadow-sm ring-2 ${theme.ring} ${theme.iconBg}`}
            >
              {NextIcon ? <NextIcon size={12} strokeWidth={3} /> : <AlertTriangle size={13} strokeWidth={2.5} />}
            </div>
          </div>
        );
      case 'dueSoon':
        return (
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center shadow-sm ring-2 ${theme.ring} ${theme.iconBg}`}
            aria-hidden="true"
          >
            {NextIcon ? <NextIcon size={12} strokeWidth={3} /> : <Clock size={13} strokeWidth={2.5} />}
          </div>
        );
      case 'scheduled':
      default:
        return (
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center shadow-sm ring-2 ${theme.ring} ${theme.iconBg}`}
            aria-hidden="true"
          >
            {NextIcon ? <NextIcon size={12} strokeWidth={3} /> : <CheckCircle2 size={13} strokeWidth={2.5} />}
          </div>
        );
    }
  })();

  const trailingBadge = status.kind === 'overdue' ? (
    <span
      className="ml-1 inline-flex items-center px-1.5 h-5 rounded-md bg-red-500 text-white text-[10px] font-bold leading-none shadow-sm"
      aria-hidden="true"
    >
      {status.daysOverdue}d
    </span>
  ) : null;

  return (
    <div className="relative flex items-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={ariaLabel}
        className="flex items-center hover:scale-110 transition-transform focus-visible-ring rounded-full"
      >
        {content}
      </button>
      {trailingBadge}

      {isOpen && dealId && menuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Agendar atividade rápida"
              style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 224 }}
              className="z-[9999] bg-white dark:bg-slate-800 rounded-lg shadow-2xl ring-1 ring-slate-200 dark:ring-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-2 border-b border-slate-100 dark:border-white/5">
                <p className="text-xs font-bold text-slate-500 uppercase px-2" id={`quick-add-heading-${dealId}`}>
                  Ações Rápidas
                </p>
              </div>

              {onMoveToStage && (
                <div className="p-1 border-b border-slate-100 dark:border-white/5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onMoveToStage();
                      onRequestClose?.();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center gap-2 focus-visible-ring"
                  >
                    <ArrowRightLeft size={14} className="text-green-500" aria-hidden="true" /> Mover para estágio…
                  </button>
                </div>
              )}

              <div className="p-1" role="group" aria-labelledby={`quick-add-heading-${dealId}`}>
                <p className="text-[10px] font-bold text-slate-400 uppercase px-3 py-1">Agendar para amanhã</p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onQuickAdd('CALL');
                    onRequestClose?.();
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center gap-2 focus-visible-ring"
                >
                  <Phone size={14} className="text-blue-500" aria-hidden="true" /> Ligar
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onQuickAdd('EMAIL');
                    onRequestClose?.();
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center gap-2 focus-visible-ring"
                >
                  <Mail size={14} className="text-purple-500" aria-hidden="true" /> Email
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onQuickAdd('MEETING');
                    onRequestClose?.();
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center gap-2 focus-visible-ring"
                >
                  <Calendar size={14} className="text-orange-500" aria-hidden="true" /> Reunião
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};
