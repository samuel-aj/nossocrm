import React, { useState } from 'react';
import { Activity } from '@/types';
import { CheckCircle2, Clock, Calendar, Phone, Mail, FileText, Building2, MoreHorizontal, X, SkipForward } from 'lucide-react';

interface InboxItemProps {
  activity: Activity;
  onToggleComplete: (id: string) => void;
  onSnooze?: (id: string) => void;
  onDiscard?: (id: string) => void;
  onSelect?: (id: string) => void;
}

/**
 * Performance: Inbox pode ter muitas linhas; `React.memo` evita re-render em massa
 * quando apenas 1 item muda (ex.: abrir/fechar menu local).
 */
const InboxItemComponent: React.FC<InboxItemProps> = ({
  activity,
  onToggleComplete,
  onSnooze,
  onDiscard,
  onSelect
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const isMeeting = activity.type === 'MEETING' || activity.type === 'CALL';
  const date = new Date(activity.date);
  const timeString = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const getIconColor = () => {
    switch (activity.type) {
      case 'CALL': return 'text-blue-500';
      case 'MEETING': return 'text-purple-500';
      case 'EMAIL': return 'text-amber-500';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="group flex items-start gap-4 p-4 bg-white dark:bg-dark-card border border-slate-100 dark:border-white/5 rounded-xl hover:shadow-md hover:border-slate-200 dark:hover:border-white/10 transition-all duration-200">
      {/* Left: Time or Checkbox */}
      <div className="shrink-0 pt-0.5">
        {isMeeting ? (
          <div className={`flex flex-col items-center justify-center w-12 h-10 rounded-lg ${getIconColor()} bg-current/10`}>
            <span className="text-xs font-bold text-current">{timeString}</span>
          </div>
        ) : (
          <button
            onClick={() => onToggleComplete(activity.id)}
            aria-label={activity.completed ? 'Marcar como pendente' : 'Marcar como concluído'}
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${activity.completed
              ? 'bg-green-500 border-green-500 text-white'
              : 'border-slate-300 dark:border-slate-600 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 text-transparent hover:text-green-500'
              }`}
          >
            <CheckCircle2 size={12} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <button
          onClick={() => onSelect?.(activity.id)}
          className="text-left group/title"
        >
          <h3 className={`font-medium text-slate-900 dark:text-white group-hover/title:text-primary-500 transition-colors ${activity.completed ? 'line-through text-slate-400 dark:text-slate-500' : ''}`}>
            {activity.title}
          </h3>
        </button>

        {activity.description && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
            {activity.description}
          </p>
        )}

        {/* Context */}
        {activity.dealTitle && (
          <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-500 dark:text-slate-400">
            <Building2 size={12} />
            <span className="truncate">{activity.dealTitle}</span>
          </div>
        )}

        {/* Helper text if no deal but onSelect exists (e.g. Contact task) */}
        {!activity.dealTitle && onSelect && (
          <button
            onClick={() => onSelect(activity.id)}
            className="flex items-center gap-1 mt-2 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            Ver detalhes
          </button>
        )}
      </div>

      {/* Actions Menu */}
      <div className="relative shrink-0">
        <button
          onClick={() => setShowMenu(!showMenu)}
          aria-label="Menu de opções"
          aria-expanded={showMenu}
          aria-haspopup="true"
          className="p-1.5 max-md:p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors opacity-0 group-hover:opacity-100 max-md:opacity-100"
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>

        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-lg shadow-lg py-1 min-w-[140px]">
              {isMeeting && (
                <button
                  onClick={() => { onToggleComplete(activity.id); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <CheckCircle2 size={14} className="text-green-500" />
                  Concluir
                </button>
              )}
              {onSnooze && (
                <button
                  onClick={() => { onSnooze(activity.id); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <Clock size={14} className="text-orange-500" />
                  Adiar 1 dia
                </button>
              )}
              {onDiscard && (
                <button
                  onClick={() => { onDiscard(activity.id); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                >
                  <X size={14} />
                  Remover
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const InboxItem = React.memo(InboxItemComponent);
