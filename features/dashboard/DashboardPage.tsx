import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/context/CRMContext';
import { useToast } from '@/context/ToastContext';
import { TrendingUp, TrendingDown, Users, DollarSign, Target, Clock, MoreVertical, AlertTriangle, Trophy, XCircle, Timer } from 'lucide-react';
import { StatCard } from './components/StatCard';
import { ActivityFeedItem } from './components/ActivityFeedItem';
import { PipelineAlertsModal } from './components/PipelineAlertsModal';
import { useDashboardMetrics, PeriodFilter, COMPARISON_LABELS } from './hooks/useDashboardMetrics';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import { LazyFunnelChart, ChartWrapper } from '@/components/charts';


/**
 * Formata a variação percentual para exibição
 */
function formatChange(value: number): { text: string; isPositive: boolean } {
  const isPositive = value >= 0;
  const sign = isPositive ? '+' : '';
  return {
    text: `${sign}${value.toFixed(1)}%`,
    isPositive,
  };
}

/**
 * Componente React `DashboardPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
const DashboardPage: React.FC = () => {
  const router = useRouter();
  // Os Relatórios de Performance ficam NA MESMA página, logo abaixo: os cards
  // que antes levavam para /reports rolam até a seção (a rota antiga é a reserva)
  const goToReports = () => {
    const el = typeof document !== 'undefined' ? document.getElementById('relatorios') : null;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else router.push('/dashboard#relatorios');
  };
  const { activities, lifecycleStages, contacts, boards } = useCRM();
  const { addToast } = useToast();
  const [period, setPeriod] = useState<PeriodFilter>('this_month');
  const [showPipelineAlerts, setShowPipelineAlerts] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');

  // Inicializar board selecionado
  useEffect(() => {
    if (!selectedBoardId && boards.length > 0) {
      const defaultB = boards.find(b => b.isDefault) || boards[0];
      setSelectedBoardId(defaultB.id);
    }
  }, [boards, selectedBoardId]);

  // Calcular contagem de contatos por estágio de ciclo de vida
  const stageCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    contacts.forEach(contact => {
      if (contact.stage) {
        counts[contact.stage] = (counts[contact.stage] || 0) + 1;
      }
    });
    return counts;
  }, [contacts]);

  useEffect(() => {
    console.log('DashboardPage mounted');
  }, []);

  const {
    deals,
    wonDeals,
    wonRevenue,
    winRate,
    pipelineValue,
    topDeals,
    funnelData,
    trendData,
    activePercent,
    inactivePercent,
    churnedPercent,
    activeContacts,
    inactiveContacts,
    churnedContacts,
    riskyCount,
    stagnantDealsCount,
    stagnantDealsValue,
    avgLTV,
    avgSalesCycle,
    fastestDeal,
    slowestDeal,
    actualWinRate,
    lostDeals,
    topLossReasons,
    wonDealsWithDates,
    changes,
    activeSnapshotDeals,
  } = useDashboardMetrics(period, selectedBoardId);

  // Formatar variações para exibição
  const pipelineChangeInfo = formatChange(changes.pipeline);
  const dealsChangeInfo = formatChange(changes.deals);
  const winRateChangeInfo = formatChange(changes.winRate);
  const revenueChangeInfo = formatChange(changes.revenue);

  return (
    // min-h (e não h fixo): quando o conteúdo passa da tela, o contêiner
    // cresce junto e o padding inferior do site continua valendo (nada
    // fica colado no rodapé)
    <div className="flex flex-col min-h-[calc(100vh-7rem)] space-y-4 pb-2">
      <div className="flex justify-between items-center shrink-0 max-md:flex-wrap max-md:gap-y-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Visão Geral
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            O pulso do seu negócio em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-3 max-md:flex-wrap max-md:w-full">
          <select
            value={selectedBoardId}
            onChange={(e) => setSelectedBoardId(e.target.value)}
            aria-label="Selecionar Pipeline de Vendas"
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {boards.map(board => (
              <option key={board.id} value={board.id}>{board.name}</option>
            ))}
          </select>

          <PeriodFilterSelect value={period} onChange={setPeriod} />

          <button
            onClick={() => setShowPipelineAlerts(true)}
            className={`p-2 rounded-lg border transition-colors relative ${(riskyCount > 0 || stagnantDealsCount > 0)
              ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30 text-amber-600 dark:text-amber-400'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700'
              }`}
            title="Alertas de Pipeline"
          >
            <AlertTriangle size={20} />
            {(riskyCount > 0 || stagnantDealsCount > 0) && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-slate-900"></span>
            )}
            <span className="sr-only">Alertas de Pipeline</span>
          </button>

          {/* Button removed */}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        <StatCard
          title="Pipeline Total"
          value={`R$ ${pipelineValue.toLocaleString('pt-BR')}`}
          subtext={pipelineChangeInfo.text}
          subtextPositive={pipelineChangeInfo.isPositive}
          icon={DollarSign}
          color="bg-blue-500"
          onClick={() => router.push('/boards')}
          comparisonLabel={COMPARISON_LABELS[period]}
        />
        <StatCard
          title="Negócios Ativos"
          value={`${deals.length - wonDeals.length}`}
          subtext={dealsChangeInfo.text}
          subtextPositive={dealsChangeInfo.isPositive}
          icon={Users}
          color="bg-purple-500"
          onClick={() => router.push('/boards?status=open')}
          comparisonLabel={COMPARISON_LABELS[period]}
        />
        <StatCard
          title="Conversão"
          value={`${winRate.toFixed(1)}%`}
          subtext={winRateChangeInfo.text}
          subtextPositive={winRateChangeInfo.isPositive}
          icon={Target}
          color="bg-emerald-500"
          onClick={goToReports}
          comparisonLabel={COMPARISON_LABELS[period]}
        />
        <StatCard
          title="Receita (Ganha)"
          value={`R$ ${wonRevenue.toLocaleString('pt-BR')}`}
          subtext={revenueChangeInfo.text}
          subtextPositive={revenueChangeInfo.isPositive}
          icon={TrendingUp}
          color="bg-orange-500"
          onClick={() => router.push('/boards?status=won&view=list')}
          comparisonLabel={COMPARISON_LABELS[period]}
        />
      </div>

      {/* Performance KPIs - Win Rate, Ciclo, Won/Lost */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        {/* Win Rate Real */}
        <div
          className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm cursor-pointer hover:border-emerald-500/50 transition-colors"
          onClick={goToReports}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Target className="text-emerald-500" size={18} />
            </div>
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Win Rate (Fechados)</span>
          </div>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {actualWinRate.toFixed(1)}%
            </span>
            <div className="flex items-center gap-2 mb-1 text-xs">
              <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                <Trophy size={14} />
                {wonDeals.length} ganhos
              </span>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <span className="flex items-center gap-1 text-red-400 font-semibold">
                <XCircle size={14} />
                {lostDeals.length} perdidos
              </span>
            </div>
          </div>
          {topLossReasons.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">Top motivos de perda</p>
              <div className="space-y-1">
                {topLossReasons.map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400 truncate mr-2">{reason}</span>
                    <span className="text-red-400 font-medium shrink-0">{count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Ciclo Médio de Vendas */}
        <div
          className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm cursor-pointer hover:border-purple-500/50 transition-colors"
          onClick={goToReports}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Timer className="text-purple-500" size={18} />
            </div>
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Ciclo Médio de Vendas</span>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {avgSalesCycle}
            </span>
            <span className="text-lg text-slate-400 mb-0.5">dias</span>
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
              Mais rápido: <span className="font-semibold text-slate-700 dark:text-slate-300">{fastestDeal}d</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-400"></div>
              Mais lento: <span className="font-semibold text-slate-700 dark:text-slate-300">{slowestDeal}d</span>
            </div>
          </div>
          {wonDealsWithDates.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
              <div className="w-full bg-slate-100 dark:bg-white/10 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-400 to-purple-500 h-full rounded-full transition-all"
                  style={{ width: `${Math.min((avgSalesCycle / Math.max(slowestDeal, 1)) * 100, 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Baseado em {wonDealsWithDates.length} deals fechados</p>
            </div>
          )}
        </div>

        {/* Deals Fechados - Breakdown */}
        <div
          className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm cursor-pointer hover:border-orange-500/50 transition-colors"
          onClick={goToReports}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-orange-500/10">
              <TrendingUp className="text-orange-500" size={18} />
            </div>
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Deals Fechados no Período</span>
          </div>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-emerald-500">{wonDeals.length}</span>
            <span className="text-lg text-slate-300 dark:text-slate-600 mb-0.5">/</span>
            <span className="text-3xl font-bold text-red-400">{lostDeals.length}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Ganhos / Perdidos</p>
          {(wonDeals.length + lostDeals.length) > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
              <div className="w-full bg-slate-100 dark:bg-white/10 rounded-full h-3 overflow-hidden flex">
                <div
                  className="bg-emerald-500 h-full transition-all"
                  style={{ width: `${(wonDeals.length / (wonDeals.length + lostDeals.length)) * 100}%` }}
                  title={`${wonDeals.length} ganhos`}
                />
                <div
                  className="bg-red-400 h-full transition-all"
                  style={{ width: `${(lostDeals.length / (wonDeals.length + lostDeals.length)) * 100}%` }}
                  title={`${lostDeals.length} perdidos`}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-[10px] text-slate-400">
                <span>R$ {wonDeals.reduce((s, d) => s + d.value, 0).toLocaleString('pt-BR')} ganho</span>
                <span>R$ {lostDeals.reduce((s, d) => s + d.value, 0).toLocaleString('pt-BR')} perdido</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Wallet Health Section - Compact */}
      <div className="space-y-3 shrink-0">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
          <Users className="text-primary-500" size={20} />
          Saúde da Carteira
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm cursor-pointer hover:border-primary-500/50 transition-colors"
            onClick={() => router.push('/contacts')}
          >
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
              Distribuição da Carteira
            </h3>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                {activePercent}%
              </span>
              <span className="text-xs text-green-500 font-bold mb-1">Ativos</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-white/10 rounded-full h-2 overflow-hidden flex">
              <div
                className="bg-green-500 h-full"
                style={{ width: `${activePercent}%` }}
                title="Ativos"
              ></div>
              <div
                className="bg-yellow-500 h-full"
                style={{ width: `${inactivePercent}%` }}
                title="Inativos"
              ></div>
              <div
                className="bg-red-500 h-full"
                style={{ width: `${churnedPercent}%` }}
                title="Churn"
              ></div>
            </div>
            <div className="flex justify-between mt-2 text-xs text-slate-500">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500"></div> Ativos (
                {activeContacts.length})
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-yellow-500"></div> Inativos (
                {inactiveContacts.length})
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-500"></div> Churn (
                {churnedContacts.length})
              </div>
            </div>
          </div>

          <div
            className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm cursor-pointer hover:border-amber-500/50 transition-colors"
            onClick={() => setShowPipelineAlerts(true)}
          >
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
              Negócios Parados
            </h3>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                {stagnantDealsCount} Deals
              </span>
              <span className={`text-xs font-bold mb-1 ${stagnantDealsCount > 0 ? 'text-amber-500' : 'text-green-500'}`}>
                {stagnantDealsCount > 0 ? 'Atenção' : 'OK'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Sem mudança de estágio há +10 dias.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              R$ {stagnantDealsValue.toLocaleString('pt-BR')} em risco
            </p>
          </div>

          <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
              LTV Médio
            </h3>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                R$ {(avgLTV / 1000).toFixed(1)}k
              </span>
              <span className="text-xs text-green-500 font-bold mb-1">Médio</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">Valor médio vitalício por cliente ativo.</p>
          </div>
        </div>
      </div>

      {/* Auto-Resize Bottom Grid */}
      {/* gap-4 (e não gap-6): mesma calha das fileiras de cima — com gap
          diferente as colunas não alinham e o Funil ficava mais estreito
          que o card acima dele */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-[300px]">
        {/* Funnel */}
        <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col h-full">
          <div className="flex justify-between items-center mb-2 shrink-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Funil
            </h2>
          </div>
          {/* max-md:min-h: no mobile o grid empilha e a altura vem do conteúdo;
              como o gráfico é absolute (altura intrínseca 0), sem o piso o
              card do Funil colapsava e o gráfico sumia. */}
          <div className="flex-1 min-h-0 relative max-md:min-h-[280px]">
            <div className="absolute inset-0">
              <ChartWrapper height="100%">
                <LazyFunnelChart data={funnelData} />
              </ChartWrapper>
            </div>
          </div>
        </div>

        {/* Activity Feed - Expanded */}
        <div className="lg:col-span-2 glass flex flex-col rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden h-full">
          <div className="p-5 border-b border-slate-100 dark:border-white/5 bg-white/50 dark:bg-slate-900/50 rounded-t-xl backdrop-blur-sm z-10 shrink-0">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                Atividades Recentes
              </h2>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 pt-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
            <div className="space-y-1">
              {activities.length > 0 ? (
                // Poucos itens de propósito: o Funil divide a linha com este
                // card e estica junto com ele; lista longa fica em /activities
                activities.slice(0, 6).map(activity => (
                  <ActivityFeedItem key={activity.id} activity={activity} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 py-8">
                  <Clock size={32} className="mb-2 opacity-50" />
                  <p className="text-sm">Nenhuma atividade recente.</p>
                </div>
              )}
            </div>

            <button
              onClick={() => router.push('/activities')}
              className="w-full mt-4 py-2 text-sm text-primary-500 border border-dashed border-primary-500/30 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
            >
              Ver todas as atividades
            </button>
          </div>
        </div>
      </div>

      {/* Pipeline Alerts Modal */}
      <PipelineAlertsModal
        isOpen={showPipelineAlerts}
        onClose={() => setShowPipelineAlerts(false)}
        deals={activeSnapshotDeals}
        activities={activities.map(a => ({ dealId: a.dealId, date: a.date, completed: a.completed }))}
        onNavigateToDeal={(dealId) => {
          setShowPipelineAlerts(false);
          router.push(`/pipeline?deal=${dealId}`);
        }}
      />
    </div>
  );
};

export default DashboardPage;
