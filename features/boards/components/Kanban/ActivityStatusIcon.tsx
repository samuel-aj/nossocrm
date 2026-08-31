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

interface ActivityStatusIconProps {
  status: DealActivityStatus;
  dealId?: string;
  dealTitle?: string;
  isOpen: boolean;
  onToggle: (e: React.MouseEvent) => void;
  onOpenSchedule: (type: 'CALL' | 'MEETING' | 'EMAIL') => void;
  onRequestClose?: () => void;
  onMoveToStage?: () => void;
}

/**
 * Deal activity status indicator — minimal Pipedrive-like visuals.
 *
 * Uses a single indicator icon per state (no type-specific phone/email/meeting
 * badges and no filled circle), because the icon communicates STATUS, not the
 * type of the next activity:
 *  - none      → outlined amber triangle (follow-up missing)
 *  - scheduled → outlined emerald check (follow-up on track)
 *  - dueSoon   → outlined orange clock (next 24h)
 *  - overdue   → filled red triangle + "Nd" overdue badge
 *
 * The quick-add dropdown renders through React Portal anchored to the button
 * rect, so it never clips inside Kanban column overflow containers.
 */
export const ActivityStatusIcon: React.FC<ActivityStatusIconProps> = ({
  status,
  dealId,
  dealTitle: _dealTitle,
  isOpen,
  onToggle,
  onOpenSchedule,
  onRequestClose,
  onMoveToStage,
}) => {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const ariaLabel = (() => {
    switch (status.kind) {
      case 'none':
        return 'Sem atividade agendada. Clique para agendar.';
      case 'overdue':
        return `Atividade atrasada há ${status.daysOverdue} ${status.daysOverdue === 1 ? 'dia' : 'dias'}. Clique para agendar outra.`;
      case 'dueSoon':
        return 'Atividade vence em breve. Clique para agendar outra.';
      case 'scheduled':
        return 'Atividade agendada. Clique para agendar outra.';
      default:
        return 'Agendar atividade';
    }
  })();

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
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isOpen]);

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

  // Simple outlined icons — the icon communicates the status, not the activity type.
  const indicator = (() => {
    switch (status.kind) {
      case 'none':
        return (
          <AlertTriangle
            size={20}
            strokeWidth={2.25}
            className="text-amber-500"
            aria-hidden="true"
          />
        );
      case 'overdue':
        return (
          <span className="relative inline-flex" aria-hidden="true">
            <span className="absolute inset-0 rounded-sm bg-red-400/40 animate-ping" />
            <AlertTriangle
              size={20}
              strokeWidth={2.5}
              fill="currentColor"
              className="relative text-red-500"
            />
          </span>
        );
      case 'dueSoon':
        return (
          <Clock
            size={20}
            strokeWidth={2.25}
            className="text-orange-500"
            aria-hidden="true"
          />
        );
      case 'scheduled':
      default:
        return (
          <CheckCircle2
            size={20}
            strokeWidth={2.25}
            className="text-emerald-500"
            aria-hidden="true"
          />
        );
    }
  })();

  // Hide the day badge when overdue by less than a full calendar day — the
  // red icon already conveys "atrasada" and "0d" would be noisy.
  //
  // Selo compacto de propósito: na visão em LISTA ele divide uma coluna
  // estreita com o ícone, e no tamanho antigo (h-5, px-1.5, ml-1) o par
  // estourava a largura útil e a linha ficava apertada. Atraso de 3 dígitos
  // ("120d") ainda cabe.
  const trailingBadge =
    status.kind === 'overdue' && status.daysOverdue >= 1 ? (
      <span
        className="ml-0.5 inline-flex h-[17px] items-center justify-center whitespace-nowrap rounded px-1 text-[9px] font-bold leading-none text-white shadow-sm bg-red-500"
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
        className="flex items-center hover:scale-110 transition-transform focus-visible-ring rounded-sm p-0.5 -m-0.5"
      >
        {indicator}
      </button>
      {trailingBadge}

      {isOpen && dealId && menuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Agendar atividade"
              style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 224 }}
              className="z-[9999] bg-white dark:bg-slate-800 rounded-lg shadow-2xl ring-1 ring-slate-200 dark:ring-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-2 border-b border-slate-100 dark:border-white/5">
                <p className="text-xs font-bold text-slate-500 uppercase px-2" id={`quick-add-heading-${dealId}`}>
                  Agendar atividade
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
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onOpenSchedule('CALL');
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
                    onOpenSchedule('EMAIL');
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
                    onOpenSchedule('MEETING');
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
