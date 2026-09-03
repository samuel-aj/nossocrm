import React from 'react';
import { Plus, Search, LayoutGrid, Table as TableIcon, X, Settings, Lightbulb, Download, MoreVertical, CheckSquare, Target, Zap, SlidersHorizontal, CalendarDays, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Board } from '@/types';
import { BoardSelector } from '../BoardSelector';
import { useOrgUsers } from '@/lib/query/hooks';
import { useAuth } from '@/context/AuthContext';

type StatusFilter = 'open' | 'won' | 'lost' | 'all';

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
    customFieldConditions: Array<{ id: string; field: string; operator: 'contains' | 'not_contains' | 'equals' | 'empty' | 'not_empty'; value: string }>;
    setCustomFieldConditions: (c: Array<{ id: string; field: string; operator: 'contains' | 'not_contains' | 'equals' | 'empty' | 'not_empty'; value: string }>) => void;
    customFieldLogic: 'AND' | 'OR';
    setCustomFieldLogic: (l: 'AND' | 'OR') => void;
    customFieldOptions: Array<{ key: string; label: string; kind: 'select' | 'text'; options: string[] }>;
    tagFilter: string;
    setTagFilter: (v: string) => void;
    tagOptions: string[];
    dateRange: { start: string; end: string };
    setDateRange: (r: { start: string; end: string }) => void;
    statusFilter: StatusFilter;
    setStatusFilter: (filter: StatusFilter) => void;
    onNewDeal: () => void;
    // Modo de seleção múltipla (menu ⋮)
    selectionMode: boolean;
    onEnterSelectionMode: () => void;
    onExitSelectionMode: () => void;
    // Modo Automatizar (só admin recebe o toggle)
    automationMode?: boolean;
    onToggleAutomationMode?: () => void;
    /** Leads visíveis com os filtros atuais (contexto do cabeçalho) */
    totalLeads?: number;
}

/** Uma condição do filtro: campo + operador + valor (quando o operador exige). */
type CfCondition = {
    id: string;
    field: string;
    operator: 'contains' | 'not_contains' | 'equals' | 'empty' | 'not_empty';
    value: string;
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string; dot: string }> = [
    { value: 'open', label: 'Em aberto', dot: 'bg-blue-500' },
    { value: 'won', label: 'Ganhos', dot: 'bg-green-500' },
    { value: 'lost', label: 'Perdidos', dot: 'bg-red-500' },
    { value: 'all', label: 'Todos', dot: 'bg-slate-400' },
];

const CONTROL_CLASS =
    'h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white backdrop-blur-sm';
const CONTROL_BUTTON_CLASS =
    'h-[38px] flex items-center gap-2 px-3 max-md:px-2.5 rounded-lg border text-sm transition-colors backdrop-blur-sm';
const CONTROL_IDLE = 'border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10';
const CONTROL_ACTIVE = 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300';
const PANEL_CLASS =
    'absolute z-50 mt-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-3 space-y-3 max-md:fixed max-md:inset-x-3 max-md:top-24 max-md:mt-0 max-md:w-auto';
const INPUT_CLASS =
    'px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white';
const SECTION_TITLE = 'text-[11px] font-bold text-slate-400 uppercase border-b border-slate-100 dark:border-white/10 pb-1';
const BADGE_CLASS = 'ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-600 text-white text-[11px] font-bold flex items-center justify-center';

/** Fecha o painel ao clicar fora dele. */
function useClickOutside(open: boolean, ref: React.RefObject<HTMLDivElement | null>, close: () => void) {
    React.useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) close();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open, ref, close]);
}

function toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatShort(iso: string): string {
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y.slice(2)}` : iso;
}

/**
 * Período: data de criação do negócio (De / Até) com atalhos.
 */
function PeriodButton({ dateRange, onChange }: { dateRange: { start: string; end: string }; onChange: (r: { start: string; end: string }) => void }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);
    const close = React.useCallback(() => setOpen(false), []);
    useClickOutside(open, ref, close);
    const active = Boolean(dateRange.start || dateRange.end);

    const preset = (days: number | 'month') => {
        const today = new Date();
        if (days === 'month') {
            onChange({ start: toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)), end: toIsoDate(today) });
            return;
        }
        const start = new Date(today);
        start.setDate(today.getDate() - (days - 1));
        onChange({ start: toIsoDate(start), end: toIsoDate(today) });
    };

    const label = !active
        ? 'Período'
        : dateRange.start && dateRange.end
            ? `${formatShort(dateRange.start)} – ${formatShort(dateRange.end)}`
            : dateRange.start
                ? `Desde ${formatShort(dateRange.start)}`
                : `Até ${formatShort(dateRange.end)}`;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                title="Período (data de criação do negócio)"
                className={`${CONTROL_BUTTON_CLASS} ${active ? CONTROL_ACTIVE : CONTROL_IDLE}`}
            >
                <CalendarDays size={15} aria-hidden="true" />
                <span className="max-md:hidden whitespace-nowrap">{label}</span>
                <ChevronDown size={13} aria-hidden="true" className={`max-md:hidden text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className={`${PANEL_CLASS} w-72`}>
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-400 uppercase">Data de criação</p>
                        {active && (
                            <button type="button" onClick={() => onChange({ start: '', end: '' })} className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                                Limpar
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {[
                            { label: 'Hoje', run: () => preset(1) },
                            { label: '7 dias', run: () => preset(7) },
                            { label: '30 dias', run: () => preset(30) },
                            { label: 'Este mês', run: () => preset('month') },
                        ].map((p) => (
                            <button
                                key={p.label}
                                type="button"
                                onClick={p.run}
                                className="px-2.5 py-1 rounded-full border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="flex-1 min-w-0 space-y-0.5">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">De</span>
                            <input
                                type="date"
                                value={dateRange.start}
                                max={dateRange.end || undefined}
                                onChange={(e) => onChange({ ...dateRange, start: e.target.value })}
                                aria-label="Criado a partir de"
                                className={`${INPUT_CLASS} w-full`}
                            />
                        </label>
                        <label className="flex-1 min-w-0 space-y-0.5">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Até</span>
                            <input
                                type="date"
                                value={dateRange.end}
                                min={dateRange.start || undefined}
                                onChange={(e) => onChange({ ...dateRange, end: e.target.value })}
                                aria-label="Criado até"
                                className={`${INPUT_CLASS} w-full`}
                            />
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Painel "Filtros": responsável, status, tag e construtor de CONDIÇÕES por
 * campo/UTM (campo + operador + valor; várias combinam com E ou OU).
 */
function FiltersButton({
    ownerFilter,
    onOwnerChange,
    owners,
    statusFilter,
    onStatusChange,
    tagFilter,
    onTagFilterChange,
    tagOptions,
    conditions,
    onConditionsChange,
    logic,
    onLogicChange,
    options,
}: {
    ownerFilter: string;
    onOwnerChange: (v: string) => void;
    owners: Array<{ id: string; name: string; role?: string }>;
    statusFilter: StatusFilter;
    onStatusChange: (v: StatusFilter) => void;
    tagFilter: string;
    onTagFilterChange: (v: string) => void;
    tagOptions: string[];
    conditions: CfCondition[];
    onConditionsChange: (c: CfCondition[]) => void;
    logic: 'AND' | 'OR';
    onLogicChange: (l: 'AND' | 'OR') => void;
    options: Array<{ key: string; label: string; kind: 'select' | 'text'; options: string[] }>;
}) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);
    const close = React.useCallback(() => setOpen(false), []);
    useClickOutside(open, ref, close);

    const activeConditions = conditions.filter(
        (c) => c.field && (c.operator === 'empty' || c.operator === 'not_empty' || c.value.trim() !== '')
    );
    const activeCount =
        activeConditions.length + (tagFilter ? 1 : 0) + (ownerFilter !== 'all' ? 1 : 0) + (statusFilter !== 'open' ? 1 : 0);

    const updateCondition = (id: string, patch: Partial<CfCondition>) =>
        onConditionsChange(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const removeCondition = (id: string) => onConditionsChange(conditions.filter((c) => c.id !== id));
    const addCondition = () =>
        onConditionsChange([
            ...conditions,
            { id: crypto.randomUUID(), field: options[0]?.key || '', operator: 'contains', value: '' },
        ]);
    const clearAll = () => {
        onConditionsChange([]);
        onTagFilterChange('');
        onOwnerChange('all');
        onStatusChange('open');
    };

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                title="Filtros: responsável, status, tag, campos e UTMs"
                className={`${CONTROL_BUTTON_CLASS} ${activeCount > 0 ? CONTROL_ACTIVE : CONTROL_IDLE}`}
            >
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span className="max-md:hidden">Filtros</span>
                {activeCount > 0 && <span className={BADGE_CLASS}>{activeCount}</span>}
            </button>
            {open && (
                <div className={`${PANEL_CLASS} w-80 max-h-[28rem] max-md:max-h-[calc(100dvh-13rem)] overflow-y-auto scrollbar-custom`}>
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-400 uppercase">Filtros</p>
                        {activeCount > 0 && (
                            <button type="button" onClick={clearAll} className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                                Limpar ({activeCount})
                            </button>
                        )}
                    </div>

                    {/* Status */}
                    <div className="space-y-2">
                        <p className={SECTION_TITLE}>Status</p>
                        <div className="grid grid-cols-2 gap-1.5">
                            {STATUS_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => onStatusChange(option.value)}
                                    aria-pressed={statusFilter === option.value}
                                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm text-left transition-colors ${statusFilter === option.value
                                        ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 font-semibold text-primary-700 dark:text-primary-300'
                                        : 'border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5'}`}
                                >
                                    <span className={`w-2 h-2 rounded-full ${option.dot}`} aria-hidden="true" />
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Responsável */}
                    <div className="space-y-2">
                        <p className={SECTION_TITLE}>Responsável</p>
                        <select
                            value={ownerFilter}
                            onChange={(e) => onOwnerChange(e.target.value)}
                            aria-label="Filtrar negócios por responsável"
                            className={`${INPUT_CLASS} w-full cursor-pointer`}
                        >
                            <option value="all">Todos os donos</option>
                            <option value="mine">Meus negócios</option>
                            {owners.length > 0 && (
                                <>
                                    <option value="none">Sem responsável</option>
                                    <optgroup label="Responsáveis">
                                        {owners.map((u) => (
                                            <option key={u.id} value={u.id}>
                                                {u.name}{u.role === 'admin' ? ' (admin)' : ''}
                                            </option>
                                        ))}
                                    </optgroup>
                                </>
                            )}
                        </select>
                    </div>

                    {/* Tag */}
                    {tagOptions.length > 0 && (
                        <div className="space-y-2">
                            <p className={SECTION_TITLE}>Tag</p>
                            <select
                                value={tagFilter}
                                onChange={(e) => onTagFilterChange(e.target.value)}
                                aria-label="Filtrar por tag"
                                className={`${INPUT_CLASS} w-full cursor-pointer`}
                            >
                                <option value="">Todas</option>
                                {tagOptions.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Campos personalizados / UTMs */}
                    {options.length > 0 && (
                        <div className="space-y-2">
                            <p className={SECTION_TITLE}>Campos personalizados e UTMs</p>
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
                                const needsValue = c.operator === 'contains' || c.operator === 'not_contains' || c.operator === 'equals';
                                return (
                                    <div key={c.id} className="rounded-lg border border-slate-200 dark:border-white/10 p-2 space-y-1.5">
                                        <div className="flex items-center gap-1.5">
                                            <select
                                                value={c.field}
                                                onChange={(e) => updateCondition(c.id, { field: e.target.value, value: '' })}
                                                aria-label="Campo"
                                                className={`${INPUT_CLASS} flex-1 min-w-0 cursor-pointer`}
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
                                                className={`${INPUT_CLASS} w-32 shrink-0 cursor-pointer`}
                                            >
                                                <option value="contains">contém</option>
                                                <option value="not_contains">não contém</option>
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
                                                        className={`${INPUT_CLASS} flex-1 min-w-0 cursor-pointer`}
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
                                                        className={`${INPUT_CLASS} flex-1 min-w-0`}
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
 * Cabeçalho do board:
 * - título da página = nome do board por extenso, com "N leads · M etapas"
 *   embaixo (não é o seletor);
 * - barra de controles: busca, seletor do board, período, filtros
 *   (responsável, status, tag, campos/UTMs); à direita, visualização,
 *   Automatizar, menu ⋮ (selecionar vários, estratégia, configurações,
 *   exportar) e Novo Negócio.
 * No modo Automatizar aparece uma faixa discreta explicando o modo.
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
    dateRange, setDateRange,
    selectionMode, onEnterSelectionMode, onExitSelectionMode,
    onNewDeal,
    automationMode = false,
    onToggleAutomationMode,
    totalLeads,
}) => {
    // Lista de responsáveis da org (admin/super_admin); para vendedor vem vazia
    // (hook desabilitado), então só aparecem "Todos" e "Meus".
    const { users: orgUsers } = useOrgUsers();
    const { profile } = useAuth();
    // "Meus negócios" já cobre o próprio usuário — evita opção duplicada na lista.
    const assignableOwners = orgUsers.filter((u) => u.id !== profile?.id);

    // Menu ⋮ (mais opções)
    const [moreMenuOpen, setMoreMenuOpen] = React.useState(false);
    const moreMenuRef = React.useRef<HTMLDivElement>(null);
    const closeMore = React.useCallback(() => setMoreMenuOpen(false), []);
    useClickOutside(moreMenuOpen, moreMenuRef, closeMore);

    const stageCount = activeBoard.stages.length;
    const contextParts = [
        typeof totalLeads === 'number' ? `${totalLeads} ${totalLeads === 1 ? 'lead' : 'leads'}` : null,
        `${stageCount} ${stageCount === 1 ? 'etapa' : 'etapas'}`,
    ].filter(Boolean);

    const menuItemClass =
        'w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors';

    return (
        <div className="mb-4 max-md:mb-3 space-y-3 max-md:space-y-2">
            {/* Título da página: nome do board por extenso + contexto */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-start gap-1.5">
                    <div className="min-w-0">
                        <h1 className="font-display font-bold text-2xl md:text-[1.75rem] leading-tight tracking-tight text-slate-900 dark:text-white break-words">
                            {activeBoard.name}
                        </h1>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                            <span>{contextParts.join(' · ')}</span>
                            {automationMode && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary-600 text-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                                    <Zap size={10} className="fill-current" aria-hidden="true" /> Automatizar · ativo
                                </span>
                            )}
                        </p>
                    </div>

                    {/* Automation Guide Button */}
                    {activeBoard.automationSuggestions && activeBoard.automationSuggestions.length > 0 && (
                        <Popover>
                            <PopoverTrigger asChild>
                                <button
                                    className="mt-1 p-1.5 text-yellow-600 hover:text-yellow-700 dark:text-yellow-400 dark:hover:text-yellow-300 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg transition-colors relative group shrink-0"
                                    title="Automações Sugeridas"
                                >
                                    <Lightbulb size={18} className="fill-current" />
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
                </div>

                {/* Ações principais: Automatizar (só admin) à esquerda de Novo Negócio */}
                <div className="flex items-center gap-2 shrink-0 max-md:gap-1.5">
                    {onToggleAutomationMode && (
                        <button
                            type="button"
                            onClick={onToggleAutomationMode}
                            aria-pressed={automationMode}
                            title={automationMode ? 'Concluir e voltar aos leads' : 'Automatizar: o que dispara em cada etapa'}
                            className={`${CONTROL_BUTTON_CLASS} font-medium ${automationMode
                                ? 'border-primary-600 bg-primary-600 text-white shadow-lg shadow-primary-600/20 hover:bg-primary-700'
                                : `${CONTROL_IDLE} hover:text-primary-700 dark:hover:text-white`}`}
                        >
                            <Zap size={15} className={automationMode ? 'fill-current' : ''} aria-hidden="true" />
                            <span className="max-md:hidden">{automationMode ? 'Concluir' : 'Automatizar'}</span>
                        </button>
                    )}
                    <button
                        onClick={onNewDeal}
                        className="max-md:hidden h-[38px] bg-primary-700 hover:bg-primary-600 text-white px-4 rounded-lg text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-primary-700/20"
                    >
                        <Plus size={18} aria-hidden="true" /> Novo Negócio
                    </button>
                    <button
                        onClick={onNewDeal}
                        aria-label="Novo negócio"
                        title="Novo negócio"
                        className="md:hidden h-[38px] w-[38px] flex items-center justify-center rounded-lg bg-primary-700 hover:bg-primary-600 text-white shadow-lg shadow-primary-700/20 active:scale-95 transition-all"
                    >
                        <Plus size={20} aria-hidden="true" />
                    </button>
                </div>
            </div>

            {/* Barra de controles */}
            <div className="flex flex-wrap items-center gap-2">
                {/* Busca: no celular ocupa a linha inteira */}
                <div className="relative flex-1 min-w-[11rem] md:max-w-xs max-md:basis-full">
                    {/* z-10: o input tem backdrop-blur (cria stacking context) e pintava POR CIMA da lupa */}
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10 pointer-events-none" size={16} />
                    <input
                        type="text"
                        placeholder="Buscar negócios ou empresas..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={`w-full pl-10 pr-4 ${CONTROL_CLASS}`}
                    />
                </div>

                {/* Seletor do board */}
                <BoardSelector
                    boards={boards}
                    activeBoard={activeBoard}
                    onSelectBoard={onSelectBoard}
                    onCreateBoard={onCreateBoard}
                    onEditBoard={onEditBoard}
                    onDeleteBoard={onDeleteBoard}
                    onReorderBoards={onReorderBoards}
                />

                {/* ⋮ mais opções, colado no seletor do board */}
                <div ref={moreMenuRef} className="relative">
                    <button
                        type="button"
                        onClick={() => setMoreMenuOpen((o) => !o)}
                        aria-expanded={moreMenuOpen}
                        aria-label="Mais opções"
                        title="Mais opções"
                        className={`h-[38px] w-[38px] flex items-center justify-center rounded-lg border text-sm transition-colors ${selectionMode ? CONTROL_ACTIVE : CONTROL_IDLE}`}
                    >
                        <MoreVertical size={18} />
                    </button>
                    {moreMenuOpen && (
                        <div className="absolute left-0 z-50 mt-1 w-56 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1">
                            {!selectionMode ? (
                                <>
                                    {/* Seleção múltipla só tem UI (checkboxes) no kanban */}
                                    {viewMode === 'kanban' && !automationMode && (
                                        <button
                                            type="button"
                                            onClick={() => { onEnterSelectionMode(); setMoreMenuOpen(false); }}
                                            className={menuItemClass}
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
                                        className={menuItemClass}
                                    >
                                        <Target size={14} /> Estratégia do board
                                    </button>
                                    {onEditBoard && (
                                        <button
                                            type="button"
                                            onClick={() => { onEditBoard(activeBoard); setMoreMenuOpen(false); }}
                                            className={menuItemClass}
                                        >
                                            <Settings size={14} /> Configurações do board
                                        </button>
                                    )}
                                    {onExportTemplates && (
                                        <button
                                            type="button"
                                            onClick={() => { onExportTemplates(); setMoreMenuOpen(false); }}
                                            className={`${menuItemClass} max-md:hidden`}
                                        >
                                            <Download size={14} /> Exportar template
                                        </button>
                                    )}
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { onExitSelectionMode(); setMoreMenuOpen(false); }}
                                    className={menuItemClass}
                                >
                                    <X size={14} /> Cancelar seleção
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <PeriodButton dateRange={dateRange} onChange={setDateRange} />

                <FiltersButton
                    ownerFilter={ownerFilter}
                    onOwnerChange={setOwnerFilter}
                    owners={assignableOwners}
                    statusFilter={statusFilter}
                    onStatusChange={setStatusFilter}
                    tagFilter={tagFilter}
                    onTagFilterChange={setTagFilter}
                    tagOptions={tagOptions}
                    conditions={customFieldConditions}
                    onConditionsChange={setCustomFieldConditions}
                    logic={customFieldLogic}
                    onLogicChange={setCustomFieldLogic}
                    options={customFieldOptions}
                />

                <div className="ml-auto flex items-center gap-2 max-md:gap-1.5">
                    {/* Modo de visualização */}
                    <div className="h-[38px] flex items-center bg-slate-100 dark:bg-white/5 p-1 rounded-lg border border-slate-200 dark:border-white/10">
                        <button
                            onClick={() => setViewMode('kanban')}
                            aria-label="Visualização em quadro Kanban"
                            title="Kanban"
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

                </div>
            </div>

            {/* Faixa discreta do modo Automatizar */}
            {automationMode && (
                <div className="flex items-center gap-2.5 rounded-lg border border-primary-200 dark:border-primary-500/30 bg-primary-50/70 dark:bg-primary-500/10 px-3 py-1.5 text-xs text-primary-800 dark:text-primary-200">
                    <Zap size={13} className="fill-current shrink-0" aria-hidden="true" />
                    <span className="min-w-0">Cada coluna mostra o que dispara quando um lead entra na etapa. Adicione ações direto na etapa.</span>
                    {onToggleAutomationMode && (
                        <button type="button" onClick={onToggleAutomationMode} className="ml-auto shrink-0 font-semibold hover:underline">
                            Concluir
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
