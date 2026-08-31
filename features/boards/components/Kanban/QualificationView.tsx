import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronsUpDown, ArrowUp, ArrowDown, Inbox } from 'lucide-react';
import { DealView, CustomFieldDefinition, Board } from '@/types';
import {
  computeQualificationView,
  QualificationTab,
} from '@/features/boards/utils/qualificationView';
import { KanbanListRow, NO_ACTIVITY_STATUS } from './KanbanList';
import { computeActivityStatusMap } from '@/features/boards/utils/dealActivityStatus';
import { useActivities } from '@/lib/query/hooks/useActivitiesQuery';
import { useOrgMembers } from '@/lib/query/hooks';

type QuickAddType = 'CALL' | 'MEETING' | 'EMAIL';

/** Abas da lista: Todos = lista plana clássica; as outras duas agrupadas. */
type ListTab = 'todos' | QualificationTab;

/** Coluna pela qual a lista pode ser ordenada. Campos fixos usam uma chave
 *  literal; campos personalizados usam o prefixo `custom:` + a key do campo
 *  (dinâmico, por isso o tipo é string em vez de union fechada). */
type SortColumn = string;
type SortDirection = 'asc' | 'desc';

interface QualificationViewProps {
  board: Board;
  filteredDeals: DealView[];
  /** Filtro de status do header; com Ganhos/Perdidos a view explica o vazio. */
  statusFilter?: 'open' | 'won' | 'lost' | 'all';
  customFieldDefinitions: CustomFieldDefinition[];
  setSelectedDealId: (id: string | null) => void;
  openActivityMenuId: string | null;
  setOpenActivityMenuId: (id: string | null) => void;
  handleQuickAddActivity: (dealId: string, type: QuickAddType, dealTitle: string) => void;
  /** Keyboard-accessible handler to move a deal to a new stage */
  onMoveDealToStage?: (dealId: string, newStageId: string) => void;
}

/** Total por etapa no cabeçalho do grupo, sem centavos (é um somatório de
 *  leitura rápida, não o valor exato de um negócio). */
const BRL_TOTAL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});
const formatTotalBRL = (value: number): string => BRL_TOTAL.format(Number.isFinite(value) ? value : 0);

/** Vazio da lista: mesma moldura pros três casos (filtro fechado, aba
 *  agrupada sem leads e aba Todos sem nada), em vez de uma frase solta. */
const ListEmptyState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500">
      <Inbox size={20} aria-hidden="true" />
    </span>
    <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{children}</p>
  </div>
);

/** Cabeçalho de coluna clicável pra ordenar a lista; seta indica a coluna e
 *  direção ativas (igual ao padrão já usado em Contatos). */
const SortableHeader: React.FC<{
  label: string;
  column: SortColumn;
  currentSort: SortColumn | null;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
  className?: string;
  align?: 'left' | 'right';
}> = ({ label, column, currentSort, sortDirection, onSort, className, align = 'left' }) => {
  const isActive = currentSort === column;
  return (
    <th
      scope="col"
      aria-sort={isActive ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-3 text-[13px] font-semibold ${
        isActive ? 'text-primary-700 dark:text-primary-300' : 'text-slate-600 dark:text-slate-300'
      } ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`group inline-flex items-center gap-1.5 rounded transition-colors hover:text-primary-600 dark:hover:text-primary-400 focus-visible-ring ${
          align === 'right' ? 'ml-auto' : ''
        }`}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        {/* A seta fica SEMPRE visível (só muda de cor quando ativa): some no
            hover, o usuário não descobre que a coluna ordena. */}
        {isActive ? (
          sortDirection === 'asc' ? (
            <ArrowUp size={13} className="text-primary-500" />
          ) : (
            <ArrowDown size={13} className="text-primary-500" />
          )
        ) : (
          <ChevronsUpDown
            size={13}
            className="text-slate-300 transition-colors group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400"
          />
        )}
      </button>
    </th>
  );
};

/**
 * Visualização em lista do pipeline, com três abas:
 * - Todos: a lista plana clássica com todos os deals filtrados
 * - Qualificação: leads ainda não qualificados (antes da etapa Qualificado),
 *   agrupados por etapa estilo ClickUp
 * - SQL: do Qualificado em diante, mais avançados primeiro
 */
export const QualificationView: React.FC<QualificationViewProps> = ({
  board,
  filteredDeals,
  statusFilter,
  customFieldDefinitions,
  setSelectedDealId,
  openActivityMenuId,
  setOpenActivityMenuId,
  handleQuickAddActivity,
  onMoveDealToStage,
}) => {
  const [activeTab, setActiveTab] = useState<ListTab>('todos');
  // Grupos recolhidos (por id da etapa); todos abertos por padrão.
  const [collapsedStageIds, setCollapsedStageIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  // Ordenação da lista (reorganizar por coluna): null = ordem natural (a que
  // já vinha em filteredDeals/nos grupos), até o usuário clicar num cabeçalho.
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Dropdown de trocar estágio: estado erguido pra cá (igual ao menu de
  // atividade) pra garantir só UM aberto por vez — abrir o de uma linha
  // fecha automaticamente o de outra, mesmo quando aberto via teclado
  // (Enter/Espaço disparam click sem mousedown, então o fechamento por
  // "clique fora" de cada linha sozinha não pegaria esse caso).
  const [openStageMenuId, setOpenStageMenuId] = useState<string | null>(null);
  const handleToggleStageMenu = useCallback((dealId: string) => {
    setOpenStageMenuId((prev) => (prev === dealId ? null : dealId));
  }, []);
  const handleCloseStageMenu = useCallback(() => setOpenStageMenuId(null), []);

  const handleSort = useCallback(
    (column: SortColumn) => {
      if (sortColumn === column) {
        setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(column);
        setSortDirection('asc');
      }
    },
    [sortColumn]
  );

  const viewData = useMemo(
    () => computeQualificationView(filteredDeals, board),
    [filteredDeals, board]
  );
  const groups = activeTab === 'todos' ? [] : viewData[activeTab];

  // Aba Todos: label da etapa por deal, como na lista clássica. Também
  // usado pra ordenar a coluna Estágio por nome da etapa.
  const stageLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of board.stages || []) {
      if (s?.id) map.set(s.id, s.label);
    }
    return map;
  }, [board.stages]);

  // Nomes p/ ordenar a coluna Responsável (o deal só guarda o ownerId).
  const { data: orgMembers = [] } = useOrgMembers();
  const ownerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of orgMembers) map.set(m.id, m.name);
    return map;
  }, [orgMembers]);

  const compareDeals = useCallback(
    (a: DealView, b: DealView): number => {
      if (!sortColumn) return 0;
      const sign = sortDirection === 'asc' ? 1 : -1;

      if (sortColumn.startsWith('custom:')) {
        const key = sortColumn.slice('custom:'.length);
        const av = String(a.customFields?.[key] ?? '');
        const bv = String(b.customFields?.[key] ?? '');
        return sign * av.localeCompare(bv, 'pt-BR');
      }

      switch (sortColumn) {
        case 'title':
          return sign * a.title.localeCompare(b.title, 'pt-BR');
        case 'tags':
          return sign * (a.tags[0] || '').localeCompare(b.tags[0] || '', 'pt-BR');
        case 'stage': {
          const av = stageLabelById.get(a.status) || a.status;
          const bv = stageLabelById.get(b.status) || b.status;
          return sign * av.localeCompare(bv, 'pt-BR');
        }
        case 'value':
          return sign * (a.value - b.value);
        case 'owner': {
          const av = (a.ownerId && ownerNameById.get(a.ownerId)) || '';
          const bv = (b.ownerId && ownerNameById.get(b.ownerId)) || '';
          return sign * av.localeCompare(bv, 'pt-BR');
        }
        case 'createdAt': {
          // Data inválida/ausente vira 0 (mesma tolerância do formatCriadoEm
          // em KanbanList.tsx) — sem isso, NaN - NaN quebra o comparator e a
          // ordem do deal afetado fica indefinida em vez de ir pra uma ponta.
          const at = new Date(a.createdAt).getTime();
          const bt = new Date(b.createdAt).getTime();
          return sign * ((Number.isNaN(at) ? 0 : at) - (Number.isNaN(bt) ? 0 : bt));
        }
        default:
          return 0;
      }
    },
    [sortColumn, sortDirection, stageLabelById, ownerNameById]
  );

  const sortedFilteredDeals = useMemo(() => {
    if (!sortColumn) return filteredDeals;
    return [...filteredDeals].sort(compareDeals);
  }, [filteredDeals, sortColumn, compareDeals]);

  const sortedGroups = useMemo(() => {
    if (!sortColumn) return groups;
    return groups.map((group) => ({ ...group, deals: [...group.deals].sort(compareDeals) }));
  }, [groups, sortColumn, compareDeals]);

  // Activity status per deal, computed from the shared activities cache.
  const { data: activities = [] } = useActivities();
  const activityStatusMap = useMemo(
    () => computeActivityStatusMap(filteredDeals, activities),
    [filteredDeals, activities]
  );

  const toggleGroup = useCallback((stageId: string) => {
    setCollapsedStageIds((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }, []);

  // Performance: callbacks estáveis evitam re-render de subcomponentes memoizados.
  const handleRowClick = useCallback(
    (dealId: string) => {
      setSelectedDealId(dealId);
    },
    [setSelectedDealId]
  );

  const handleToggleMenu = useCallback(
    (e: React.MouseEvent, dealId: string) => {
      e.stopPropagation();
      setOpenActivityMenuId(openActivityMenuId === dealId ? null : dealId);
    },
    [openActivityMenuId, setOpenActivityMenuId]
  );

  const handleCloseMenu = useCallback(() => setOpenActivityMenuId(null), [setOpenActivityMenuId]);

  const handleQuickAdd = useCallback(
    (dealId: string, type: QuickAddType, dealTitle: string) => {
      handleQuickAddActivity(dealId, type, dealTitle);
    },
    [handleQuickAddActivity]
  );

  const tabs: Array<{ id: ListTab; label: string; count: number }> = [
    { id: 'todos', label: 'Todos', count: filteredDeals.length },
    { id: 'qualificacao', label: 'Qualificação', count: viewData.qualificacaoCount },
    { id: 'sql', label: 'SQL', count: viewData.sqlCount },
  ];

  const totalColumns = 7 + customFieldDefinitions.length;
  // Sem etapa Qualificado no funil (ex.: board de pós-venda) a aba SQL não
  // tem o que mostrar; o aviso fala de leads, não de configuração de etapas.
  const sqlUnavailable = activeTab === 'sql' && !viewData.qualifiedStage;
  const emptyMessage =
    activeTab === 'qualificacao'
      ? 'Nenhum lead em qualificação neste funil no momento.'
      : 'Nenhum lead qualificado neste funil no momento.';
  // Com o filtro do header em Ganhos/Perdidos, todo deal é descartado pelas
  // abas Qualificação/SQL (que só mostram negócios em aberto) — explica em
  // vez de zerar. A aba Todos mostra o que o filtro mandar, como sempre.
  const showClosedFilterNotice =
    activeTab !== 'todos' && (statusFilter === 'won' || statusFilter === 'lost');

  return (
    <div className="h-full overflow-hidden glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col">
      <div className="flex items-center gap-1 border-b border-slate-200 px-3 py-2 dark:border-white/5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition-colors focus-visible-ring ${
              activeTab === tab.id
                ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/20'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
            }`}
          >
            {tab.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                activeTab === tab.id
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200/80 text-slate-600 dark:bg-white/10 dark:text-slate-300'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto scrollbar-custom">
        {showClosedFilterNotice ? (
          <ListEmptyState>
            O filtro de status está em{' '}
            <span className="font-bold">{statusFilter === 'won' ? 'Ganhos' : 'Perdidos'}</span>, e
            estas abas mostram apenas negócios em aberto. Mude o filtro para{' '}
            <span className="font-bold">Em Aberto</span> para ver a Qualificação e o SQL.
          </ListEmptyState>
        ) : activeTab !== 'todos' && (sqlUnavailable || groups.length === 0) ? (
          <ListEmptyState>{emptyMessage}</ListEmptyState>
        ) : activeTab === 'todos' && filteredDeals.length === 0 ? (
          <ListEmptyState>Nenhum negócio neste funil com os filtros atuais.</ListEmptyState>
        ) : (
          <table
            // table-fixed + colgroup: larguras fixas, independentes do
            // conteúdo e da presença do cabeçalho. Sem isso, abrir/fechar
            // um grupo recalculava as colunas e os títulos "pulavam".
            // max-md:min-w-[40rem]: no celular a tabela ganha scroll
            // horizontal próprio (o wrapper é overflow-auto) em vez de
            // esmagar as colunas abaixo do próprio padding.
            className="w-full table-fixed max-md:min-w-[50rem] text-left text-sm border-collapse"
          >
            <colgroup>
              {/* Larguras equilibradas: antes o Negócio levava 24% (vão
                  enorme até a Tag, já que título de lead é curto) e a última
                  coluna ficava espremida. w-16 no ícone menos o px-2 da
                  célula deixa 48px úteis (ícone de 20px + selo "Nd"). */}
              <col className="w-16" />
              <col className="w-[25%]" />
              <col className="w-[14%]" />
              <col className="w-[15%]" />
              <col className="w-[12%]" />
              <col className="w-[18%]" />
              <col className="w-[16%]" />
              {customFieldDefinitions.map((field) => (
                <col key={field.id} />
              ))}
            </colgroup>
            {/* Cabeçalho de colunas só na aba Todos; nas abas agrupadas os
                grupos ficam colados nas abas e dão o contexto sozinhos. */}
            {activeTab === 'todos' && (
              <thead className="sticky top-0 z-10 border-b border-slate-200/80 bg-primary-50/50 backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.04]">
                <tr>
                  <th scope="col" className="px-2 py-3">
                    <span className="sr-only">Próxima atividade</span>
                  </th>
                  <SortableHeader
                    label="Negócio"
                    column="title"
                    currentSort={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Tag"
                    column="tags"
                    currentSort={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Estágio"
                    column="stage"
                    currentSort={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  {/* Valor à esquerda como as demais: alinhado à direita ele
                      encostava no avatar do Responsável e o espaçamento das
                      colunas ficava irregular. */}
                  <SortableHeader
                    label="Valor"
                    column="value"
                    currentSort={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Responsável"
                    column="owner"
                    currentSort={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Criado em"
                    column="createdAt"
                    currentSort={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    className="whitespace-nowrap"
                  />
                  {/* Custom Fields Columns */}
                  {customFieldDefinitions.map((field) => (
                    <SortableHeader
                      key={field.id}
                      label={field.label}
                      column={`custom:${field.key}`}
                      currentSort={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      className="text-right"
                      align="right"
                    />
                  ))}
                </tr>
              </thead>
            )}
            {/* divide-y só na aba Todos: nas agrupadas os filetes entre as
                linhas cortavam a faixa colorida e criavam uma barra entre o
                título do grupo e os leads dele. */}
            <tbody
              className={
                activeTab === 'todos'
                  ? 'divide-y divide-slate-100/80 dark:divide-white/[0.06]'
                  : undefined
              }
            >
              {activeTab === 'todos' &&
                sortedFilteredDeals.map((deal) => (
                  <KanbanListRow
                    key={deal.id}
                    deal={deal}
                    stageLabel={stageLabelById.get(deal.status) || deal.status}
                    stages={board.stages}
                    customFieldDefinitions={customFieldDefinitions}
                    activityStatus={activityStatusMap.get(deal.id) ?? NO_ACTIVITY_STATUS}
                    isMenuOpen={openActivityMenuId === deal.id}
                    onSelect={handleRowClick}
                    onToggleMenu={handleToggleMenu}
                    onQuickAdd={handleQuickAdd}
                    onCloseMenu={handleCloseMenu}
                    onMoveDealToStage={onMoveDealToStage}
                    isStageMenuOpen={openStageMenuId === deal.id}
                    onToggleStageMenu={handleToggleStageMenu}
                    onCloseStageMenu={handleCloseStageMenu}
                  />
                ))}
              {sortedGroups.map((group, groupIndex) => {
                const isCollapsed = collapsedStageIds.has(group.stage.id);
                return (
                  <React.Fragment key={group.stage.id}>
                    {/* Filete na cor da etapa liga o cabeçalho do grupo às
                        linhas dele, deixando claro o que pertence a quem. */}
                    <tr
                      className={`bg-slate-50/90 dark:bg-white/[0.04] ${
                        groupIndex > 0 ? 'border-t border-slate-200/70 dark:border-white/10' : ''
                      }`}
                    >
                      <td colSpan={totalColumns} className="relative px-4 py-2">
                        <span
                          aria-hidden="true"
                          className={`absolute inset-y-0 left-0 w-[3px] ${group.stage.color || 'bg-slate-500'}`}
                        />
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.stage.id)}
                          aria-expanded={!isCollapsed}
                          className="flex w-full items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-slate-900 dark:hover:text-white focus-visible-ring"
                        >
                          <ChevronDown
                            size={14}
                            aria-hidden="true"
                            className={`shrink-0 text-slate-400 transition-transform ${
                              isCollapsed ? '-rotate-90' : ''
                            }`}
                          />
                          <span
                            className={`${group.stage.color || 'bg-slate-500'} rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white`}
                          >
                            {group.stage.label}
                          </span>
                          <span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                            {group.deals.length}
                          </span>
                          {/* Total da etapa: mesma leitura das colunas do
                              Kanban, que já somam o valor por etapa. */}
                          <span className="ml-auto pr-1 text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                            {formatTotalBRL(group.deals.reduce((sum, d) => sum + (d.value || 0), 0))}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {!isCollapsed &&
                      group.deals.map((deal) => (
                        <KanbanListRow
                          key={deal.id}
                          deal={deal}
                          stageLabel={group.stage.label}
                          stages={board.stages}
                          customFieldDefinitions={customFieldDefinitions}
                          activityStatus={activityStatusMap.get(deal.id) ?? NO_ACTIVITY_STATUS}
                          isMenuOpen={openActivityMenuId === deal.id}
                          accentColor={group.stage.color || 'bg-slate-500'}
                          onSelect={handleRowClick}
                          onToggleMenu={handleToggleMenu}
                          onQuickAdd={handleQuickAdd}
                          onCloseMenu={handleCloseMenu}
                          onMoveDealToStage={onMoveDealToStage}
                          isStageMenuOpen={openStageMenuId === deal.id}
                          onToggleStageMenu={handleToggleStageMenu}
                          onCloseStageMenu={handleCloseStageMenu}
                        />
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
