import React from 'react';
import { Plus, Search, LayoutGrid, Table as TableIcon, User, Tag, Settings, Lightbulb, Download } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Board } from '@/types';
import { BoardSelector } from '../BoardSelector';
import { useOrgUsers } from '@/lib/query/hooks';
import { useAuth } from '@/context/AuthContext';

interface KanbanHeaderProps {
    // Boards
    boards: Board[];
    activeBoard: Board;
    onSelectBoard: (id: string) => void;
    onCreateBoard: () => void;
    onEditBoard?: (board: Board) => void;
    onDeleteBoard?: (id: string) => void;
    onExportTemplates?: () => void;
    // View
    viewMode: 'kanban' | 'list';
    setViewMode: (mode: 'kanban' | 'list') => void;
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    ownerFilter: string;
    setOwnerFilter: (filter: string) => void;
    customFieldFilters: Record<string, string>;
    setCustomFieldFilters: (f: Record<string, string>) => void;
    customFieldOptions: Array<{ key: string; label: string; kind: 'select' | 'text'; options: string[] }>;
    tagFilter: string;
    setTagFilter: (v: string) => void;
    tagOptions: string[];
    statusFilter: 'open' | 'won' | 'lost' | 'all';
    setStatusFilter: (filter: 'open' | 'won' | 'lost' | 'all') => void;
    onNewDeal: () => void;
}

/**
 * Filtro por campo personalizado/UTM: botão "Filtros" que abre um painel com
 * um controle por campo — SELECT quando o campo tem poucos valores distintos
 * (ex.: Laudo médico: Sim/Não) e INPUT de texto quando é valor livre (ex.:
 * renda). Vários campos combinam em E (AND). Badge mostra quantos ativos.
 */
function CustomFieldFiltersButton({
    filters,
    onChange,
    options,
    tagFilter,
    onTagFilterChange,
    tagOptions,
}: {
    filters: Record<string, string>;
    onChange: (f: Record<string, string>) => void;
    options: Array<{ key: string; label: string; kind: 'select' | 'text'; options: string[] }>;
    tagFilter: string;
    onTagFilterChange: (v: string) => void;
    tagOptions: string[];
}) {
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const activeCount =
        Object.values(filters).filter((v) => v && v.trim() !== '').length + (tagFilter ? 1 : 0);
    const setField = (key: string, value: string) => {
        const next = { ...filters };
        if (value) next[key] = value;
        else delete next[key];
        onChange(next);
    };

    const utms = options.filter((o) => o.key.startsWith('utm_'));
    const customs = options.filter((o) => !o.key.startsWith('utm_'));

    const renderField = (o: { key: string; label: string; kind: 'select' | 'text'; options: string[] }) => {
        const current = filters[o.key] ?? '';
        return (
            <div key={o.key} className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate" title={o.key}>
                    {o.label}
                </label>
                {o.kind === 'select' ? (
                    <select
                        value={current}
                        onChange={(e) => setField(o.key, e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white cursor-pointer"
                    >
                        <option value="">Todos</option>
                        {o.options.map((v) => (
                            <option key={v} value={v}>{v}</option>
                        ))}
                    </select>
                ) : (
                    <input
                        type="text"
                        value={current}
                        onChange={(e) => setField(o.key, e.target.value)}
                        placeholder="Digite para filtrar..."
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                    />
                )}
            </div>
        );
    };

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors backdrop-blur-sm ${activeCount > 0
                    ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10'
                    }`}
                title="Filtrar por campos personalizados e UTMs"
            >
                <Tag size={14} />
                Filtros
                {activeCount > 0 && (
                    <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-600 text-white text-[11px] font-bold flex items-center justify-center">
                        {activeCount}
                    </span>
                )}
            </button>
            {open && (
                <div className="absolute z-50 mt-1 w-80 max-h-96 overflow-y-auto scrollbar-custom rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-400 uppercase">Filtrar por campos</p>
                        {activeCount > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    onChange({});
                                    onTagFilterChange('');
                                }}
                                className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                            >
                                Limpar ({activeCount})
                            </button>
                        )}
                    </div>
                    {tagOptions.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[11px] font-bold text-slate-400 uppercase border-b border-slate-100 dark:border-white/10 pb-1">Tag</p>
                            <select
                                value={tagFilter}
                                onChange={(e) => onTagFilterChange(e.target.value)}
                                aria-label="Filtrar por tag"
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white cursor-pointer"
                            >
                                <option value="">Todas</option>
                                {tagOptions.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {utms.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[11px] font-bold text-slate-400 uppercase border-b border-slate-100 dark:border-white/10 pb-1">UTMs</p>
                            {utms.map(renderField)}
                        </div>
                    )}
                    {customs.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[11px] font-bold text-slate-400 uppercase border-b border-slate-100 dark:border-white/10 pb-1">Campos personalizados</p>
                            {customs.map(renderField)}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Componente React `KanbanHeader`.
 *
 * @param {KanbanHeaderProps} {
    boards,
    activeBoard,
    onSelectBoard,
    onCreateBoard,
    onEditBoard,
    onDeleteBoard,
    onExportTemplates,
    viewMode, setViewMode,
    searchTerm, setSearchTerm,
    ownerFilter, setOwnerFilter,
    statusFilter, setStatusFilter,
    onNewDeal
} - Parâmetro `{
    boards,
    activeBoard,
    onSelectBoard,
    onCreateBoard,
    onEditBoard,
    onDeleteBoard,
    onExportTemplates,
    viewMode, setViewMode,
    searchTerm, setSearchTerm,
    ownerFilter, setOwnerFilter,
    statusFilter, setStatusFilter,
    onNewDeal
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const KanbanHeader: React.FC<KanbanHeaderProps> = ({
    boards,
    activeBoard,
    onSelectBoard,
    onCreateBoard,
    onEditBoard,
    onDeleteBoard,
    onExportTemplates,
    viewMode, setViewMode,
    searchTerm, setSearchTerm,
    ownerFilter, setOwnerFilter,
    statusFilter, setStatusFilter,
    customFieldFilters, setCustomFieldFilters, customFieldOptions,
    tagFilter, setTagFilter, tagOptions,
    onNewDeal
}) => {
    // Lista de responsáveis da org (admin/super_admin); para vendedor vem vazia
    // (hook desabilitado), então só aparecem "Todos" e "Meus".
    const { users: orgUsers } = useOrgUsers();
    const { profile } = useAuth();
    // "Meus Negócios" já cobre o próprio usuário — evita opção duplicada na lista.
    const assignableOwners = orgUsers.filter((u) => u.id !== profile?.id);
    return (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
            <div className="flex items-center gap-4 w-full sm:w-auto flex-wrap">
                {/* Board Selector */}
                <BoardSelector
                    boards={boards}
                    activeBoard={activeBoard}
                    onSelectBoard={onSelectBoard}
                    onCreateBoard={onCreateBoard}
                    onEditBoard={onEditBoard}
                    onDeleteBoard={onDeleteBoard}
                />

                {/* Edit Board Button */}
                {onEditBoard && (
                    <button
                        onClick={() => onEditBoard(activeBoard)}
                        className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                        title="Configurações do Board"
                    >
                        <Settings size={20} />
                    </button>
                )}

                {/* Export Template Button */}
                {onExportTemplates && (
                    <button
                        onClick={onExportTemplates}
                        className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                        title="Exportar template (comunidade)"
                    >
                        <Download size={20} />
                    </button>
                )}

                {/* Automation Guide Button */}
                {activeBoard.automationSuggestions && activeBoard.automationSuggestions.length > 0 && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                className="p-2 text-yellow-600 hover:text-yellow-700 dark:text-yellow-400 dark:hover:text-yellow-300 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg transition-colors relative group"
                                title="Automações Sugeridas"
                            >
                                <Lightbulb size={20} className="fill-current" />
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="start">
                            <div className="p-4 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-slate-900/50">
                                <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                    <Lightbulb size={16} className="text-yellow-500" />
                                    Automações Sugeridas
                                </h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Dicas da IA para otimizar este processo.
                                </p>
                            </div>
                            <div className="p-2">
                                <ul className="space-y-1">
                                    {activeBoard.automationSuggestions.map((suggestion, idx) => (
                                        <li key={idx} className="text-sm text-slate-700 dark:text-slate-300 p-2 hover:bg-slate-50 dark:hover:bg-white/5 rounded-md flex gap-2 items-start">
                                            <span className="text-slate-400 mt-0.5">•</span>
                                            <span>{suggestion}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </PopoverContent>
                    </Popover>
                )}

                {/* VIEW TOGGLE */}
                <div className="flex bg-slate-100 dark:bg-white/5 p-1 rounded-lg border border-slate-200 dark:border-white/10">
                    <button
                        onClick={() => setViewMode('kanban')}
                        aria-label="Visualização em quadro Kanban"
                        aria-pressed={viewMode === 'kanban'}
                        className={`p-1.5 rounded-md transition-all ${viewMode === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                    >
                        <LayoutGrid size={16} aria-hidden="true" />
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        aria-label="Visualização em lista"
                        aria-pressed={viewMode === 'list'}
                        className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                    >
                        <TableIcon size={16} aria-hidden="true" />
                    </button>
                </div>

                <div className="h-8 w-px bg-slate-200 dark:bg-white/10 mx-2 hidden sm:block"></div>
                <div className="relative flex-1 sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="Filtrar negócios ou empresas..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white backdrop-blur-sm"
                    />
                </div>
                <div className="relative">
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                        aria-label="Filtrar por status"
                        className="pl-3 pr-8 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white backdrop-blur-sm appearance-none cursor-pointer"
                    >
                        <option value="open">Em Aberto</option>
                        <option value="won">Ganhos</option>
                        <option value="lost">Perdidos</option>
                        <option value="all">Todos</option>
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <div className={`w-2 h-2 rounded-full ${statusFilter === 'open' ? 'bg-blue-500' :
                            statusFilter === 'won' ? 'bg-green-500' :
                                statusFilter === 'lost' ? 'bg-red-500' : 'bg-slate-400'
                            }`} />
                    </div>
                </div>

                <div className="relative">
                    <select
                        value={ownerFilter}
                        onChange={(e) => setOwnerFilter(e.target.value)}
                        aria-label="Filtrar negócios por proprietário"
                        className="pl-3 pr-8 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white backdrop-blur-sm appearance-none cursor-pointer"
                    >
                        <option value="all">Todos os Donos</option>
                        <option value="mine">Meus Negócios</option>
                        {assignableOwners.length > 0 && (
                            <>
                                <option value="none">Sem responsável</option>
                                <optgroup label="Responsáveis">
                                    {assignableOwners.map((u) => (
                                        <option key={u.id} value={u.id}>
                                            {u.name}{u.role === 'admin' ? ' (admin)' : ''}
                                        </option>
                                    ))}
                                </optgroup>
                            </>
                        )}
                    </select>
                    <User className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                </div>

                {/* Filtros por tag / campo personalizado / UTM (um controle por campo) */}
                {(customFieldOptions.length > 0 || tagOptions.length > 0) && (
                    <CustomFieldFiltersButton
                        filters={customFieldFilters}
                        onChange={setCustomFieldFilters}
                        options={customFieldOptions}
                        tagFilter={tagFilter}
                        onTagFilterChange={setTagFilter}
                        tagOptions={tagOptions}
                    />
                )}
            </div>

            <div className="flex gap-3">
                <button
                    onClick={onNewDeal}
                    className="bg-primary-700 hover:bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-primary-700/20"
                >
                    <Plus size={18} aria-hidden="true" /> Novo Negócio
                </button>
            </div>
        </div>
    );
};
