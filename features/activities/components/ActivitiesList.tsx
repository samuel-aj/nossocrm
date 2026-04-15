import React, { useMemo } from 'react';
import { Activity, Deal, Contact, Company } from '@/types';
import { ActivityRow } from './ActivityRow';

interface ActivitiesListProps {
    activities: Activity[];
    deals: Deal[];
    contacts: Contact[];
    companies: Company[];
    onToggleComplete: (id: string) => void;
    onEdit: (activity: Activity) => void;
    onDelete: (id: string) => void;
    selectedActivities?: Set<string>;
    onSelectActivity?: (id: string, selected: boolean) => void;
}

/**
 * Componente React `ActivitiesList`.
 *
 * @param {ActivitiesListProps} {
    activities,
    deals,
    onToggleComplete,
    onEdit,
    onDelete,
    selectedActivities = new Set(),
    onSelectActivity
} - Parâmetro `{
    activities,
    deals,
    onToggleComplete,
    onEdit,
    onDelete,
    selectedActivities = new Set(),
    onSelectActivity
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ActivitiesList: React.FC<ActivitiesListProps> = ({
    activities,
    deals,
    contacts,
    companies,
    onToggleComplete,
    onEdit,
    onDelete,
    selectedActivities = new Set(),
    onSelectActivity
}) => {
    // Performance: Activities pode ser uma lista grande; evitamos `find` por linha (O(N*M)).
    const dealById = useMemo(() => {
        const map = new Map<string, Deal>();
        for (const d of deals) map.set(d.id, d);
        return map;
    }, [deals]);

    const contactById = useMemo(() => {
        const map = new Map<string, Contact>();
        for (const c of contacts) map.set(c.id, c);
        return map;
    }, [contacts]);

    const companyById = useMemo(() => {
        const map = new Map<string, Company>();
        for (const c of companies) map.set(c.id, c);
        return map;
    }, [companies]);

    const HISTORY_TYPES = new Set(['STATUS_CHANGE', 'NOTE']);

    const tasks = useMemo(() =>
        activities
            .filter(a => !HISTORY_TYPES.has(a.type))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [activities]
    );

    const history = useMemo(() =>
        activities
            .filter(a => HISTORY_TYPES.has(a.type))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [activities]
    );

    if (activities.length === 0) {
        return (
            <div className="text-center py-12 bg-white dark:bg-dark-card rounded-xl border border-slate-200 dark:border-white/5 border-dashed">
                <p className="text-slate-500 dark:text-slate-400">Nenhuma atividade encontrada</p>
            </div>
        );
    }

    const renderRow = (activity: Activity) => (
        <ActivityRow
            key={activity.id}
            activity={activity}
            deal={activity.dealId ? dealById.get(activity.dealId) : undefined}
            contact={activity.contactId ? contactById.get(activity.contactId) : undefined}
            company={activity.clientCompanyId ? companyById.get(activity.clientCompanyId) : undefined}
            onToggleComplete={onToggleComplete}
            onEdit={onEdit}
            onDelete={onDelete}
            isSelected={selectedActivities.has(activity.id)}
            onSelect={onSelectActivity}
        />
    );

    return (
        <div className="space-y-6">
            {tasks.length > 0 && (
                <div>
                    <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary-500" />
                        Tarefas ({tasks.length})
                    </h3>
                    <div className="space-y-3">
                        {tasks.map(renderRow)}
                    </div>
                </div>
            )}

            {history.length > 0 && (
                <div>
                    <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400" />
                        Histórico ({history.length})
                    </h3>
                    <div className="space-y-1">
                        {history.map(activity => (
                            <div
                                key={activity.id}
                                className="flex items-center justify-between py-2 px-3 text-sm text-slate-500 dark:text-slate-400 bg-white/50 dark:bg-white/[0.02] rounded-lg border border-slate-100 dark:border-white/5"
                            >
                                <span>{activity.title}</span>
                                <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap ml-4">
                                    {new Date(activity.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
