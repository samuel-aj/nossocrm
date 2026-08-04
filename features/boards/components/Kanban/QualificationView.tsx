import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DealView, CustomFieldDefinition, Board } from '@/types';
import {
  computeQualificationView,
  QualificationTab,
} from '@/features/boards/utils/qualificationView';
import { KanbanListRow, NO_ACTIVITY_STATUS } from './KanbanList';
import { computeActivityStatusMap } from '@/features/boards/utils/dealActivityStatus';
import { useActivities } from '@/lib/query/hooks/useActivitiesQuery';

type QuickAddType = 'CALL' | 'MEETING' | 'EMAIL';

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

/**
 * Visualização "Qualificação / SQL": divide o funil em duas listas
 * agrupadas por etapa (estilo ClickUp), independente da etapa exata:
 * - Qualificação: leads ainda não qualificados (antes da etapa Qualificado)
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
  const [activeTab, setActiveTab] = useState<QualificationTab>('qualificacao');
  // Grupos recolhidos (por id da etapa); todos abertos por padrão.
  const [collapsedStageIds, setCollapsedStageIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  const viewData = useMemo(
    () => computeQualificationView(filteredDeals, board),
    [filteredDeals, board]
  );
  const groups = viewData[activeTab];

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

  const tabs: Array<{ id: QualificationTab; label: string; count: number }> = [
    { id: 'qualificacao', label: 'Qualificação', count: viewData.qualificacaoCount },
    { id: 'sql', label: 'SQL', count: viewData.sqlCount },
  ];

  const totalColumns = 6 + customFieldDefinitions.length;
  // Sem etapa Qualificado no funil (ex.: board de pós-venda) a aba SQL não
  // tem o que mostrar; o aviso fala de leads, não de configuração de etapas.
  const sqlUnavailable = activeTab === 'sql' && !viewData.qualifiedStage;
  const emptyMessage =
    activeTab === 'qualificacao'
      ? 'Nenhum lead em qualificação neste funil no momento.'
      : 'Nenhum lead qualificado neste funil no momento.';
  // Com o filtro do header em Ganhos/Perdidos, todo deal é descartado por
  // esta view (que só mostra negócios em aberto) — explica em vez de zerar.
  const closedStatusFilter = statusFilter === 'won' || statusFilter === 'lost';

  return (
    <div className="h-full overflow-hidden glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-200 dark:border-white/5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors focus-visible-ring ${
              activeTab === tab.id
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            {tab.label}
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === tab.id
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto scrollbar-custom">
        {closedStatusFilter ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            O filtro de status está em{' '}
            <span className="font-bold">{statusFilter === 'won' ? 'Ganhos' : 'Perdidos'}</span>, e
            esta visualização mostra apenas negócios em aberto. Mude o filtro para{' '}
            <span className="font-bold">Em Aberto</span> para ver a Qualificação e o SQL.
          </div>
        ) : sqlUnavailable || groups.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {emptyMessage}
          </div>
        ) : (
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-slate-50/80 dark:bg-white/5 border-b border-slate-200 dark:border-white/5 sticky top-0 z-10 backdrop-blur-sm">
              <tr>
                <th className="px-6 py-3 font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10"></th>
                <th className="px-6 py-3 font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Negócio
                </th>
                <th className="px-6 py-3 font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Empresa
                </th>
                <th className="px-6 py-3 font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Estágio
                </th>
                <th className="px-6 py-3 font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Valor
                </th>
                <th className="px-6 py-3 font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Dono
                </th>
                {/* Custom Fields Columns */}
                {customFieldDefinitions.map((field) => (
                  <th
                    key={field.id}
                    className="px-6 py-3 font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right"
                  >
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {groups.map((group) => {
                const isCollapsed = collapsedStageIds.has(group.stage.id);
                return (
                  <React.Fragment key={group.stage.id}>
                    <tr className="bg-slate-50/60 dark:bg-white/[0.03]">
                      <td colSpan={totalColumns} className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.stage.id)}
                          aria-expanded={!isCollapsed}
                          className="flex items-center gap-2 w-full text-left focus-visible-ring rounded-md"
                        >
                          <ChevronDown
                            size={14}
                            aria-hidden="true"
                            className={`text-slate-400 transition-transform ${
                              isCollapsed ? '-rotate-90' : ''
                            }`}
                          />
                          <span
                            className={`${group.stage.color || 'bg-slate-500'} text-white text-[11px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full`}
                          >
                            {group.stage.label}
                          </span>
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                            {group.deals.length}
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
                          onSelect={handleRowClick}
                          onToggleMenu={handleToggleMenu}
                          onQuickAdd={handleQuickAdd}
                          onCloseMenu={handleCloseMenu}
                          onMoveDealToStage={onMoveDealToStage}
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
