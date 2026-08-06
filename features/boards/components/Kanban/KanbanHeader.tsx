import React from 'react';
import { Plus, Search, LayoutGrid, Table as TableIcon, User, Tag, X, Settings, Lightbulb, Download, MoreVertical, CheckSquare, Target } from 'lucide-react';
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
    onReorderBoards?: (orderedIds: string[]) => void;
    onExportTemplates?: () => void;
    // View
    viewMode: 'kanban' | 'list';
    setViewMode: (mode: 'kanban' | 'list') => void;
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    ownerFilter: string;
    setOwnerFilter: (filter: string) => void;
    customFieldConditions: Array<{ id: string; field: string; operator: 'contains' | 'equals' | 'empty' | 'not_empty'; value: string }>;
    setCustomFieldConditions: (c: Array<{ id: string; field: string; operator: 'contains' | 'equals' | 'empty' | 'not_empty'; value: string }>) => void;
    customFieldLogic: 'AND' | 'OR';
    setCustomFieldLogic: (l: 'AND' | 'OR') => void;
    customFieldOptions: Array<{ key: string; label: string; kind: 'select' | 'text'; options: string[] }>;
    tagFilter: string;
    setTagFilter: (v: string) => void;
    tagOptions: string[];
    statusFilter: 'open' | 'won' | 'lost' | 'all';
    setStatusFilter: (filter: 'open' | 'won' | 'lost' | 'all') => void;
    onNewDeal: () => void;
    // Modo de seleção múltipla (menu ⋮)
    selectionMode: boolean;
    onEnterSelectionMode: () => void;
    onExitSelectionMode: () => void;
}

/** Uma condição do filtro: campo + operador + valor (quando o operador exige). */
type CfCondition = {
    id: string;
    field: string;
    operator: 'contains' | 'equals' | 'empty' | 'not_empty';
    value: string;
};

/**
 * Painel "Filtros" com construtor de CONDIÇÕES por campo/UTM:
 * cada condição = campo + operador (contém / é igual a / está vazio / está
 * preenchido) + valor (campos select oferecem as opções no "é igual a").
 * Várias condições combinam com E (todas) ou OU (qualquer). A seção Tag é um
 * select à parte (tags cadastradas em Configurações) e soma junto (E).
 */
function CustomFieldFiltersButton({
    conditions,
    onConditionsChange,
    logic,
    onLogicChange,
    options,
    tagFilter,
    onTagFilterChange,
    tagOptions,
}: {
    conditions: CfCondition[];
    onConditionsChange: (c: CfCondition[]) => void;
    logic: 'AND' | 'OR';
    onLogicChange: (l: 'AND' | 'OR') => void;
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

    const activeConditions = conditions.filter(
        (c) => c.field && (c.operator === 'empty' || c.operator === 'not_empty' || c.value.trim() !== '')
    );
    const activeCount = activeConditions.length + (tagFilter ? 1 : 0);

    const updateCondition = (id: string, patch: Partial<CfCondition>) =>
        onConditionsChange(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const removeCondition = (id: string) => onConditionsChange(conditions.filter((c) => c.id !== id));
    const addCondition = () =>
        onConditionsChange([
            ...conditions,
            { id: crypto.randomUUID(), field: options[0]?.key || '', operator: 'contains', value: '' },
        ]);

    const inputClass =
        'px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white';

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
                title="Filtrar por tag, campos personalizados e UTMs"
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
                <div className="absolute z-50 mt-1 w-80 max-h-[28rem] max-md:fixed max-md:inset-x-3 max-md:top-24 max-md:mt-0 max-md:w-auto max-md:max-h-[calc(100dvh-13rem)] overflow-y-auto scrollbar-custom rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-400 uppercase">Filtros</p>
                        {activeCount > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    onConditionsChange([]);
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
                                className={`${inputClass} w-full cursor-pointer`}
                            >
                                <option value="">Todas</option>
                                {tagOptions.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {options.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[11px] font-bold text-slate-400 uppercase border-b border-slate-100 dark:border-white/10 pb-1">
                                Condições (campos/UTMs)
                            </p>
                            {conditions.length >= 2 && (
                                <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                    <span>Atender:</span>
                                    <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => onLogicChange('AND')}
                                            className={`px-2 py-1 font-bold transition-colors ${logic === 'AND' ? 'bg-primary-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5'}`}
                                        >
                                            E (todas)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onLogicChange('OR')}
                                            className={`px-2 py-1 font-bold transition-colors ${logic === 'OR' ? 'bg-primary-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5'}`}
                                        >
                                            OU (qualquer)
                                        </button>
                                    </div>
                                </div>
                            )}
                            {conditions.map((c) => {
                                const fieldDef = options.find((o) => o.key === c.field);
                                const needsValue = c.operator === 'contains' || c.operator === 'equals';
                                return (
                                    <div key={c.id} className="rounded-lg border border-slate-200 dark:border-white/10 p-2 space-y-1.5">
                                        <div className="flex items-center gap-1.5">
                                            <select
                                                value={c.field}
                                                onChange={(e) => updateCondition(c.id, { field: e.target.value, value: '' })}
                                                aria-label="Campo"
                                                className={`${inputClass} flex-1 min-w-0 cursor-pointer`}
                                            >
                                                {options.map((o) => (
                                                    <option key={o.key} value={o.key}>{o.label}</option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => removeCondition(c.id)}
                                                aria-label="Remover condição"
                                                title="Remover condição"
                                                className="shrink-0 p-1 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <select
                                                value={c.operator}
                                                onChange={(e) => updateCondition(c.id, { operator: e.target.value as CfCondition['operator'] })}
                                                aria-label="Operador"
                                                className={`${inputClass} w-32 shrink-0 cursor-pointer`}
                                            >
                                                <option value="contains">contém</option>
                                                <option value="equals">é igual a</option>
                                                <option value="empty">está vazio</option>
                                                <option value="not_empty">está preenchido</option>
                                            </select>
                                            {needsValue && (
                                                fieldDef?.kind === 'select' && fieldDef.options.length > 0 && c.operator === 'equals' ? (
                                                    <select
                                                        value={c.value}
                                                        onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                                                        aria-label="Valor"
                                                        className={`${inputClass} flex-1 min-w-0 cursor-pointer`}
                                                    >
                                                        <option value="">Selecione...</option>
                                                        {fieldDef.options.map((v) => (
                                                            <option key={v} value={v}>{v}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input
                                                        type="text"
                                                        value={c.value}
                                                        onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                                                        placeholder="valor..."
                                                        aria-label="Valor"
                                                        className={`${inputClass} flex-1 min-w-0`}
                                                    />
                                                )
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            <button
                                type="button"
                                onClick={addCondition}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                            >
                                <Plus size={13} /> Adicionar condição
                            </button>
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
    onReorderBoards,
    onExportTemplates,
    viewMode, setViewMode,
    searchTerm, setSearchTerm,
    ownerFilter, setOwnerFilter,
    statusFilter, setStatusFilter,
    customFieldConditions, setCustomFieldConditions, customFieldLogic, setCustomFieldLogic, customFieldOptions,
    tagFilter, setTagFilter, tagOptions,
    selectionMode, onEnterSelectionMode, onExitSelectionMode,
    onNewDeal
}) => {
    // Lista de responsáveis da org (admin/super_admin); para vendedor vem vazia
    // (hook desabilitado), então só aparecem "Todos" e "Meus".
    const { users: orgUsers } = useOrgUsers();
    const { profile } = useAuth();
    // Menu ⋮ (mais opções)
    const [moreMenuOpen, setMoreMenuOpen] = React.useState(false);
    const moreMenuRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (!moreMenuOpen) return;
        const handler = (e: MouseEvent) => {
            if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [moreMenuOpen]);
    // "Meus Negócios" já cobre o próprio usuário — evita opção duplicada na lista.
    const assignableOwners = orgUsers.filter((u) => u.id !== profile?.id);
    return (
        // Empilha até md (celular deitado incluso): flex-wrap em coluna
        // quebrava os itens pro LADO quando faltava altura.
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 max-md:mb-3 max-md:gap-2">
            <div className="flex items-center gap-4 w-full md:w-auto flex-wrap max-md:gap-2">
                {/* Board Selector */}
                <BoardSelector
                    boards={boards}
                    activeBoard={activeBoard}
                    onSelectBoard={onSelectBoard}
                    onCreateBoard={onCreateBoard}
                    onEditBoard={onEditBoard}
                    onDeleteBoard={onDeleteBoard}
                    onReorderBoards={onReorderBoards}
                />

                {/* Edit Board Button */}
                {onEditBoard && (
                    <button
                        onClick={() => onEditBoard(activeBoard)}
                        className="p-2 max-md:p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                        title="Configurações do Board"
                    >
                        <Settings size={20} className="max-md:w-[18px] max-md:h-[18px]" />
                    </button>
                )}

                {/* Export Template Button (tarefa de desktop; some no celular) */}
                {onExportTemplates && (
                    <button
                        onClick={onExportTemplates}
                        className="p-2 max-md:hidden text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
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
                        title="Lista (Todos / Qualificação / SQL)"
                        aria-pressed={viewMode === 'list'}
                        className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                    >
                        <TableIcon size={16} aria-hidden="true" />
                    </button>
                </div>

                <div className="h-8 w-px bg-slate-200 dark:bg-white/10 mx-2 hidden md:block"></div>
                <div className="relative flex-1 sm:w-64">
                    {/* z-10: o input tem backdrop-blur (cria stacking context) e pintava POR CIMA da lupa */}
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10 pointer-events-none" size={16} />
                    <input
                        type="text"
                        placeholder="Filtrar negócios ou empresas..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 max-md:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white backdrop-blur-sm"
                    />
                </div>
                {/* Status: select só no desktop; no mobile vira as abas abaixo */}
                <div className="relative max-md:hidden">
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
                        className="pl-3 pr-8 py-2 max-md:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white backdrop-blur-sm appearance-none cursor-pointer"
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

                {/* Filtros: tag (select) + construtor de condições por campo/UTM */}
                {(customFieldOptions.length > 0 || tagOptions.length > 0) && (
                    <CustomFieldFiltersButton
                        conditions={customFieldConditions}
                        onConditionsChange={setCustomFieldConditions}
                        logic={customFieldLogic}
                        onLogicChange={setCustomFieldLogic}
                        options={customFieldOptions}
                        tagFilter={tagFilter}
                        onTagFilterChange={setTagFilter}
                        tagOptions={tagOptions}
                    />
                )}
            </div>

            <div className="flex gap-3">
                {/* ⋮ mais opções (ex.: Selecionar vários) */}
                <div ref={moreMenuRef} className="relative">
                    <button
                        type="button"
                        onClick={() => setMoreMenuOpen((o) => !o)}
                        aria-expanded={moreMenuOpen}
                        aria-label="Mais opções"
                        title="Mais opções"
                        className={`p-2 rounded-lg border text-sm transition-colors ${selectionMode
                            ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                            : 'border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10'
                            }`}
                    >
                        <MoreVertical size={18} />
                    </button>
                    {moreMenuOpen && (
                        <div className="absolute right-0 z-50 mt-1 w-52 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1">
                            {!selectionMode ? (
                                <>
                                {/* Seleção múltipla só tem UI (checkboxes) no kanban */}
                                {viewMode === 'kanban' && (
                                <button
                                    type="button"
                                    onClick={() => { onEnterSelectionMode(); setMoreMenuOpen(false); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                                >
                                    <CheckSquare size={14} /> Selecionar vários
                                </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Abre o editor de estratégia do board (o banner de CTA
                                        // não existe mais no kanban — este é o ponto de entrada).
                                        window.dispatchEvent(new Event('crm:board-strategy-edit'));
                                        setMoreMenuOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                                >
                                    <Target size={14} /> Estratégia do board
                                </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { onExitSelectionMode(); setMoreMenuOpen(false); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                                >
                                    <X size={14} /> Cancelar seleção
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <button
                    onClick={onNewDeal}
                    className="bg-primary-700 hover:bg-primary-600 text-white px-4 py-2 max-md:py-1.5 max-md:flex-1 max-md:justify-center rounded-lg text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-primary-700/20"
                >
                    <Plus size={18} aria-hidden="true" /> Novo Negócio
                </button>
            </div>

            {/* Status como ABAS (só mobile; no desktop continua o select) */}
            <div className="md:hidden w-full flex items-center gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-lg border border-slate-200 dark:border-white/10">
                {([
                    ['open', 'Em Aberto'],
                    ['won', 'Ganhos'],
                    ['lost', 'Perdidos'],
                    ['all', 'Todos'],
                ] as const).map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => setStatusFilter(value)}
                        aria-pressed={statusFilter === value}
                        className={`flex-1 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-colors ${statusFilter === value
                            ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600 dark:text-white'
                            : 'text-slate-500 dark:text-slate-400'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
};
