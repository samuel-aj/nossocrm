import React from 'react';
import { Search, Filter } from 'lucide-react';
import { Activity } from '@/types';

interface ActivitiesFiltersProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filterType: Activity['type'] | 'ALL';
  setFilterType: (type: Activity['type'] | 'ALL') => void;
}

/**
 * Componente React `ActivitiesFilters`.
 *
 * @param {ActivitiesFiltersProps} {
  searchTerm,
  setSearchTerm,
  filterType,
  setFilterType,
} - Parâmetro `{
  searchTerm,
  setSearchTerm,
  filterType,
  setFilterType,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ActivitiesFilters: React.FC<ActivitiesFiltersProps> = ({
  searchTerm,
  setSearchTerm,
  filterType,
  setFilterType,
}) => {
  return (
    <div className="flex gap-4 mb-6 max-md:flex-wrap max-md:gap-2 max-md:mb-4">
      <div className="flex-1 relative max-md:basis-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input
          type="text"
          placeholder="Buscar atividades..."
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 text-slate-900 dark:text-white"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2 max-md:w-full">
        <Filter size={20} className="text-slate-400 max-md:hidden" />
        <select
          className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 max-md:w-full max-md:py-2 outline-none focus:ring-2 focus:ring-primary-500 text-slate-900 dark:text-white"
          value={filterType}
          onChange={e => setFilterType(e.target.value as Activity['type'] | 'ALL')}
        >
          <option value="ALL">Todos os tipos</option>
          <option value="CALL">Ligações</option>
          <option value="MEETING">Reuniões</option>
          <option value="EMAIL">Emails</option>
          <option value="TASK">Tarefas</option>
        </select>
      </div>
    </div>
  );
};
