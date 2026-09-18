'use client';

/**
 * Faixa acima do compositor com as atividades PENDENTES do lead: a mais urgente
 * sempre à vista (atrasada, hoje ou agendada, com texto e ícone), as demais num
 * resumo que expande. Clicar abre a atividade no compositor para ver, editar,
 * remarcar ou concluir.
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Activity } from '@/types';
import { ACTIVITY_TYPE_LABEL, ActivityTypeIcon, DueBadge, dueState } from './LeadTimeline';

const DT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function pendingActivitiesOf(activities: Activity[]): Activity[] {
  return activities
    .filter(a => !a.completed && a.type !== 'NOTE' && a.type !== 'STATUS_CHANGE' && (a.type as string) !== 'note')
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function Row({
  a,
  onOpen,
  onComplete,
  canEdit,
  pending,
}: {
  a: Activity;
  onOpen: (a: Activity) => void;
  onComplete: (a: Activity) => void;
  canEdit: boolean;
  pending: boolean;
}) {
  return (
    <li className="flex items-center gap-2 min-w-0">
      {canEdit && (
        <button
          type="button"
          onClick={() => onComplete(a)}
          disabled={pending}
          aria-label={`Concluir: ${a.title}`}
          title="Concluir"
          className="h-4 w-4 shrink-0 rounded border border-slate-300 dark:border-slate-600 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 flex items-center justify-center disabled:opacity-40"
        >
          <Check size={10} className="opacity-0 hover:opacity-100 text-emerald-600" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onOpen(a)}
        className="min-w-0 flex-1 flex items-center gap-2 text-left rounded-md px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-white/10"
        title="Ver, editar ou remarcar"
      >
        <span className="shrink-0 text-slate-400">
          <ActivityTypeIcon type={a.type} size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
          <span className="sr-only">{ACTIVITY_TYPE_LABEL[a.type] ?? 'Atividade'}: </span>
          {a.title}
        </span>
        <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{DT.format(new Date(a.date))}</span>
        {a.assignedToName && <span className="shrink-0 max-w-[90px] truncate text-[11px] text-slate-400 max-sm:hidden">{a.assignedToName}</span>}
        <span className="shrink-0">
          <DueBadge date={a.date} completed={false} />
        </span>
      </button>
    </li>
  );
}

export function PendingActivitiesStrip({
  activities,
  onOpen,
  onComplete,
  canEdit,
  isPending,
}: {
  activities: Activity[];
  onOpen: (a: Activity) => void;
  onComplete: (a: Activity) => void;
  canEdit: boolean;
  isPending: (id: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const pending = useMemo(() => pendingActivitiesOf(activities), [activities]);
  if (pending.length === 0) return null;
  const overdue = pending.filter(a => dueState(a.date) === 'overdue').length;
  const today = pending.filter(a => dueState(a.date) === 'today').length;
  const [first, ...rest] = pending;
  return (
    <section aria-label="Atividades pendentes" className="px-3 pt-2">
      <div
        className={`rounded-xl border px-2.5 py-1.5 ${
          overdue
            ? 'border-red-200 dark:border-red-500/30 bg-red-50/60 dark:bg-red-900/10'
            : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20'
        }`}
      >
        <ul className="space-y-1">
          <Row a={first} onOpen={onOpen} onComplete={onComplete} canEdit={canEdit} pending={isPending(first.id)} />
          {expanded && rest.map(a => <Row key={a.id} a={a} onOpen={onOpen} onComplete={onComplete} canEdit={canEdit} pending={isPending(a.id)} />)}
        </ul>
        {rest.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-primary-600"
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded
              ? 'Mostrar só a próxima'
              : `Mais ${rest.length} pendente${rest.length > 1 ? 's' : ''}${overdue > 1 || (overdue === 1 && dueState(first.date) !== 'overdue') ? ` · ${overdue} atrasada${overdue > 1 ? 's' : ''}` : ''}${today ? ` · ${today} para hoje` : ''}`}
          </button>
        )}
      </div>
    </section>
  );
}
