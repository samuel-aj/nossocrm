import { FilterSelect } from '@/components/filters/FilterSelect';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
const LazyStageConversionChart = dynamic(() => import('./StagePerformanceChart').then(module => module.StageConversionChart), { ssr: false });
import { TrendingUp, Clock, Target, DollarSign, Trophy, Users, Download, UserX, CheckCircle2, SlidersHorizontal } from 'lucide-react';
import { getDateRange, PeriodFilter, PERIOD_LABELS, COMPARISON_LABELS } from '../dashboard/hooks/useDashboardMetrics';
import { ReportFiltersPopover } from './ReportFiltersPopover';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { LossReasonsCard } from './LossReasonsCard';
import { LeadSourceChart } from './LeadSourceChart';
import { REPORT_MODES } from './reportPresentation';
import { generateReportPDF } from './utils/generateReportPDF';
import { useCRM } from '@/context/CRMContext';
import { useAuth } from '@/context/AuthContext';
import { performanceComparisonRange } from './performanceMetrics';
import { usePerformanceReport } from './usePerformanceReport';
import { StageLeadsModal } from './StageLeadsModal';
import { ReportLeadsModal } from './ReportLeadsModal';
import { NO_PRODUCT, reportDrilldown, type ReportSelection } from './reportDrilldown';

/**
 * Componente React `ReportsPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
const ReportsPage: React.FC = () => {
  const { boards, deals: allCrmDeals, products = [] } = useCRM();
  const { profile } = useAuth();
  const mode = 'period';
  const [dayKey, setDayKey] = useState(() => new Date().toDateString());
  useEffect(() => {
    const timer = setInterval(() => setDayKey(new Date().toDateString()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [period, setPeriod] = useState<PeriodFilter>('this_month');
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = Number(period !== 'all') + Number(Boolean(selectedOwnerId)) + Number(Boolean(selectedProductId));
  const [selection, setSelection] = useState<ReportSelection | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  useEffect(() => { setSelectedStageId(null); setSelection(null); }, [mode, period, selectedBoardId, selectedOwnerId, selectedProductId]);

  // Performance: avoid recomputing the "default board id" logic inside the effect.
  const defaultBoardId = useMemo(() => {
    if (!boards.length) return '';
    const defaultB = boards.find(b => b.isDefault) || boards[0];
    return defaultB?.id || '';
  }, [boards]);

  // Inicializar board selecionado
  useEffect(() => {
    if (!selectedBoardId && defaultBoardId) {
      setSelectedBoardId(defaultBoardId);
    }
  }, [defaultBoardId, selectedBoardId]);
  // No primeiro paint selectedBoardId ainda é '' (o efeito só roda depois):
  // usar o default direto evita um frame com métricas agregadas de TODOS os
  // boards (e PDF exportado nesse instante sairia errado).
  const boardIdEfetivo = selectedBoardId || defaultBoardId;

  // Pegar o board selecionado para acessar a meta
  const selectedBoard = useMemo(() => {
    return boards.find(b => b.id === boardIdEfetivo);
  }, [boards, boardIdEfetivo]);

  const range = useMemo(() => getDateRange(period), [period, dayKey]);
  const comparisonRange = useMemo(() => performanceComparisonRange(range, period), [range, period]);
  const report = usePerformanceReport(selectedBoard, range, selectedOwnerId, comparisonRange, selectedProductId, mode);
  const metrics = report.data;
  const productOptions = useMemo(() => {
    const options = new Map<string, string>((metrics?.productOptions || []).map(product => [product.id, product.name]));
    for (const product of products) options.set(product.id, product.name);
    return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [metrics?.productOptions, products]);
  const productLabel = selectedProductId === NO_PRODUCT ? 'Sem produto' : productOptions.find(item => item.value === selectedProductId)?.label || 'Todos os produtos';
  const detail = metrics && selection ? reportDrilldown(metrics, selection) : null;
  const ownersList = useMemo(() => {
    const map = new Map<string, string>();
    for (const owner of metrics?.ownerOptions || []) map.set(owner.id, owner.name);
    for (const deal of metrics?.deals || allCrmDeals) if (deal.ownerId) map.set(deal.ownerId, deal.owner.name);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [metrics?.deals, metrics?.ownerOptions, allCrmDeals]);
  const wonDeals = metrics?.wonDeals || [];
  const lostDeals = metrics?.lostDeals || [];
  const wonRevenue = metrics?.wonRevenue || 0;
  // Calcular Performance por Vendedor (Leaderboard)
  const leaderboard = React.useMemo(() => {
    const repsMap: Record<string, { name: string; avatar: string; deals: number; revenue: number; winRate: number }> = {};

    wonDeals.forEach(deal => {
      const ownerKey = deal.ownerId || 'unassigned';
      const ownerName = deal.owner?.name || 'Sem Dono';
      const ownerAvatar = deal.owner?.avatar || '';

      if (!repsMap[ownerKey]) {
        repsMap[ownerKey] = { name: ownerName, avatar: ownerAvatar, deals: 0, revenue: 0, winRate: 0 };
      }
      repsMap[ownerKey].deals += 1;
      repsMap[ownerKey].revenue += deal.value;
    });

    return Object.entries(repsMap)
      .map(([id, data]) => ({
        id,
        ...data,
        winRate: data.deals > 0 ? Math.round((data.deals / Math.max(data.deals, 1)) * 100) : 0
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [wonDeals]);

  // Formatador de moeda
  const formatCurrency = useCallback((value: number) => {
    if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}k`;
    return `R$ ${value.toLocaleString('pt-BR')}`;
  }, []);

  const stageConversionData = metrics?.entryFunnel.stages || [];
  const selectedStage = stageConversionData.find(stage => stage.stageId === selectedStageId);

  const generatedBy = useMemo(() => {
    if (profile?.first_name && profile?.last_name) return `${profile.first_name} ${profile.last_name}`;
    return profile?.first_name || profile?.email || 'Usuário';
  }, [profile?.email, profile?.first_name, profile?.last_name]);

  const handleExportPDF = useCallback(() => {
    if (!metrics || report.isFetching || report.isError) return;
    generateReportPDF(metrics, {
      mode, customerPipeline: selectedBoard?.linkedLifecycleStage === 'CUSTOMER', boardName: selectedBoard?.name || '', period: PERIOD_LABELS[period],
      owner: ownersList.find(owner => owner.id === selectedOwnerId)?.name || 'Todos os vendedores', product: productLabel,
      range: range.start.toLocaleDateString('pt-BR') + ' a ' + range.end.toLocaleDateString('pt-BR'), generatedBy,
    });
  }, [mode, metrics, report.isFetching, report.isError, selectedBoard, period, selectedOwnerId, ownersList, range, generatedBy, productLabel]);

  const renderLossReasons = (dealsSubset: typeof lostDeals, barClass: string, category: 'qualified' | 'disqualified') => (
    <LossReasonsCard key={`${mode}:${boardIdEfetivo}:${period}:${category}`} deals={dealsSubset} barClass={barClass}
      onSelect={reasonKey => setSelection({ kind: 'loss', category, reasonKey })} />
  );
  const modeInfo = REPORT_MODES[mode];

  return (
    // min-h (não h fixo!): com altura FIXA o conteúdo transbordava e os cards
    // colavam na borda. Com min-h a página cresce e o padding PADRÃO do app
    // (p-6 do <main>, igual laterais/topo) dá o respiro — sem pb extra aqui.
    <div className="flex flex-col min-h-[calc(100vh-7rem)] max-md:min-h-0 space-y-4">
      {/* Header com Filtros */}
      <div className="flex flex-wrap justify-between items-center gap-3 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Relatórios de Performance
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Análise detalhada de vendas e tendências.
          </p>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3 max-md:w-full">
          <div className="w-56 min-w-0 max-md:flex-1"><FilterSelect label="Selecionar Pipeline" value={boardIdEfetivo} onChange={setSelectedBoardId} options={boards.map(board => ({value:board.id,label:board.name}))} /></div>
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <button type="button"
                title={`Período: ${PERIOD_LABELS[period]} · ${ownersList.find(owner => owner.id === selectedOwnerId)?.name || 'Todos os vendedores'} · ${productLabel}`}
                className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-white/15 dark:bg-slate-900 dark:text-slate-200">
                <SlidersHorizontal size={16} aria-hidden="true" />
                Filtros
                {activeFilterCount > 0 && <span aria-label={`${activeFilterCount} filtros ativos`} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-500/15 px-1 text-xs text-primary-600 dark:text-primary-300">{activeFilterCount}</span>}
              </button>
            </PopoverTrigger>
            {filtersOpen && <ReportFiltersPopover filters={{ period, ownerId: selectedOwnerId, productId: selectedProductId }}
              owners={ownersList} products={productOptions} onClose={() => setFiltersOpen(false)}
              onApply={filters => {
                setPeriod(filters.period);
                setSelectedOwnerId(filters.ownerId);
                setSelectedProductId(filters.productId);
                setFiltersOpen(false);
              }} />}
          </Popover>

          <button
            type="button"
            disabled={!metrics || report.isFetching || report.isError}
            onClick={handleExportPDF}
            className="group flex min-h-11 shrink-0 items-center gap-2 px-3 py-2 rounded-lg glass border border-slate-200/50 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/20 transition-all duration-200"
            title="Exportar PDF"
          >
            <Download size={16} className="group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium opacity-80 group-hover:opacity-100">PDF</span>
          </button>
        </div>
      </div>

      {report.isError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">Não foi possível carregar o relatório. {report.error.message} <button className="underline" onClick={() => void report.refetch()}>Tentar novamente</button></div>}
      {!metrics && !report.isError && <p role="status">Carregando histórico de movimentações…</p>}
      {metrics && !report.isError && <>
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 shrink-0">
        {/* Pipeline Value - FEATURE #2 */}
        <button type="button" onClick={() => setSelection({ kind: 'revenue' })} className="glass text-left p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm hover:border-primary-400 dark:hover:border-primary-500/50 focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <DollarSign className="text-blue-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Faturamento fechado</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatCurrency(wonRevenue)}</p>
          <p className={`text-xs ${metrics.revenueChange == null ? 'text-slate-500' : metrics.revenueChange < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
            {period === 'all' ? 'Ganhos em todo o período' : metrics.revenueChange == null ? 'Sem base no período anterior' : `${metrics.revenueChange >= 0 ? '+' : ''}${metrics.revenueChange.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% ${COMPARISON_LABELS[period]}`}
          </p>
        </button>

        {/* Primeiras qualificações no período selecionado */}
        <button type="button" onClick={() => setSelection({ kind: 'qualification' })} className="glass text-left p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm hover:border-primary-400 dark:hover:border-primary-500/50 focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Target className="text-emerald-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Qualificados no período</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {metrics.qualifiedCount}
          </p>
          <p className="text-xs text-slate-500">
            Primeira qualificação comprovada no intervalo
          </p>
        </button>

        {/* Ganhos no período selecionado */}
        <button type="button" onClick={() => setSelection({ kind: 'closing' })} className="glass text-left p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm hover:border-primary-400 dark:hover:border-primary-500/50 focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-teal-500/10">
              <TrendingUp className="text-teal-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Ganhos no período</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {wonDeals.length}
          </p>
          <p className="text-xs text-slate-500">
            Ganhos pela data do acontecimento
          </p>
        </button>

        {/* Ciclo Médio */}
        <button type="button" onClick={() => setSelection({ kind: 'cycle' })} className="glass text-left p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm hover:border-primary-400 dark:hover:border-primary-500/50 focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Clock className="text-purple-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Ciclo Médio</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{metrics.avgSalesCycle === null ? '—' : metrics.avgSalesCycle + ' dias'}</p>
          <p className="text-xs text-slate-500">
            {metrics.fastestSalesCycle == null ? 'Sem ganhos no período' : `Rápido: ${metrics.fastestSalesCycle}d | Lento: ${metrics.slowestSalesCycle}d`}
          </p>
        </button>

        {/* Deals Fechados */}
        <button type="button" onClick={() => setSelection({ kind: 'closures' })} className="glass text-left p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm hover:border-primary-400 dark:hover:border-primary-500/50 focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-orange-500/10">
              <TrendingUp className="text-orange-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Fechamentos</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            <span className="text-emerald-600">{wonDeals.length} ganhos</span>
          </p>
          <p className="text-xs text-slate-500">
            {lostDeals.filter(deal => deal.lossCategory === 'qualified').length} perdas qualificadas
          </p>
        </button>
      </div>

      {/* Origens à esquerda; etapas em colunas verticais à direita. */}
      <div className="grid auto-rows-fr grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
        <LeadSourceChart groups={metrics.leadSourceGroups} total={metrics.leadSourceTotal} mode={mode}
          legacySnapshotCount={metrics.coverage.legacyLeadSourceSnapshotCount}
          onSelect={keys => setSelection({ kind: 'source', keys })} />
        <section aria-label={modeInfo.chartTitle} className="glass h-full p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col min-w-0 lg:col-span-2">
          <div className="flex flex-wrap justify-between items-center gap-2 mb-4 shrink-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              {modeInfo.chartTitle}
            </h2>
            <span className="text-xs text-slate-500 bg-slate-100 dark:bg-white/5 px-2 py-1 rounded">
              {modeInfo.chartBasis}
            </span>
          </div>
          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <button type="button" onClick={() => setSelection({ kind: 'entries' })}
              className="rounded-md py-1 text-slate-500 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-400 dark:hover:text-primary-400">
              Entradas no funil: <strong className="text-slate-900 dark:text-white">{metrics.entries.length}</strong>
            </button>
            <button type="button" onClick={() => setSelection({ kind: 'reopened' })}
              className="rounded-md py-1 text-slate-500 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-400 dark:hover:text-primary-400">
              Reaberturas: <strong className="text-slate-900 dark:text-white">{metrics.reopenedDeals.length}</strong>
            </button>
          </div>
          <LazyStageConversionChart data={stageConversionData} onStageClick={setSelectedStageId}
            description="Dos leads que entraram no período, quantos chegaram a cada etapa ou avançaram além dela." />
          <p className="mt-4 text-xs text-slate-500">Avanço pela ordem das etapas, até o fim do período. Cada lead conta uma vez por coluna; etapas puladas não viram movimentações no histórico.</p>
          {metrics.entryFunnel.unknownStageCount > 0 && <p className="mt-2 text-xs text-slate-500">
            {metrics.entryFunnel.unknownStageCount} {metrics.entryFunnel.unknownStageCount === 1 ? 'entrada sem etapa válida para este gráfico fica' : 'entradas sem etapa válida para este gráfico ficam'} fora das colunas.
          </p>}
        </section>
      </div>

      {/* Fileira de baixo: Motivos de Perda + Desqualificação (+ Top Vendedores) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {lostDeals.length > 0 && <div className="lg:col-span-2 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <section aria-label="Perdas qualificadas" className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 mb-4">
                <CheckCircle2 className="text-orange-500" size={20} />
                Motivos de Perda — Qualificados
              </h2>
              <button type="button" onClick={() => setSelection({ kind: 'loss', category: 'qualified' })}
                className="mb-4 w-full text-left focus-visible:ring-2 focus-visible:ring-primary-500 hover:brightness-110 flex items-center justify-between gap-3 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-500/20">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Qualificados perdidos</span>
                <span className="text-lg font-bold text-orange-600 dark:text-orange-400">{lostDeals.filter(d => d.lossCategory === 'qualified').length}</span>
              </button>
              {renderLossReasons(lostDeals.filter(d => d.lossCategory === 'qualified'), 'bg-orange-500', 'qualified')}
            </section>
            <section aria-label="Desqualificações" className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 mb-4">
                <UserX className="text-red-500" size={20} />
                Desqualificação
              </h2>
              <button type="button" onClick={() => setSelection({ kind: 'loss', category: 'disqualified' })}
                className="mb-4 w-full text-left focus-visible:ring-2 focus-visible:ring-primary-500 hover:brightness-110 flex items-center justify-between gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-500/20">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Total desqualificados</span>
                <span className="text-lg font-bold text-red-600 dark:text-red-400">{lostDeals.filter(d => d.lossCategory === 'disqualified').length}</span>
              </button>
              {renderLossReasons(lostDeals.filter(d => d.lossCategory === 'disqualified'), 'bg-red-500', 'disqualified')}
            </section>
          </div>
          {lostDeals.some(d => !d.lossCategory) && <button type="button" onClick={() => setSelection({ kind: 'loss', category: 'unknown' })}
            className="rounded-md px-1 py-1 text-sm text-slate-500 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500">
            Sem classificação: <strong>{lostDeals.filter(d => !d.lossCategory).length}</strong>
          </button>}
        </div>}

        {/* Leaderboard - FEATURE #3 (Top Performers) */}
        <div
          className={`glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col overflow-hidden ${
            lostDeals.length > 0 ? '' : 'lg:col-span-3'
          }`}
        >
          <div className="flex justify-between items-center mb-3 shrink-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
              <Trophy className="text-amber-500" size={20} />
              Top Vendedores
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
            {leaderboard.length > 0 ? (
              leaderboard.map((rep, index) => (
                <button type="button" onClick={() => setSelection({ kind: 'owner', ownerId: rep.id, ownerName: rep.name })}
                  key={rep.id}
                  className="w-full text-left focus-visible:ring-2 focus-visible:ring-primary-500 flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors"
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${index === 0 ? 'bg-amber-100 text-amber-600' :
                    index === 1 ? 'bg-slate-100 text-slate-600' :
                      index === 2 ? 'bg-orange-100 text-orange-600' :
                        'bg-slate-50 text-slate-500'
                    }`}>
                    {index + 1}
                  </div>
                  <Image
                    src={rep.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${rep.name}`}
                    alt={rep.name}
                    width={32}
                    height={32}
                    className="w-8 h-8 rounded-full"
                    unoptimized
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{rep.name}</p>
                    <p className="text-xs text-slate-500">{rep.deals} deals</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-500">{formatCurrency(rep.revenue)}</p>
                  </div>
                </button>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 py-6">
                <Users size={32} className="mb-2 opacity-50" />
                <p className="text-sm">Nenhum deal fechado no período.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Espaçador REAL depois do último bloco: quando o conteúdo transborda
          a altura fixa do container, padding no root não aparece (fica no
          limite nominal da caixa, não abaixo do conteúdo transbordado) —
          este elemento garante a margem inferior em qualquer cenário */}
      <div className="shrink-0 h-2" aria-hidden="true" />
      {detail && metrics && selectedBoard && <ReportLeadsModal key={JSON.stringify(selection)} detail={detail} board={selectedBoard}
        filtersLabel={`${selectedBoard.name} · ${modeInfo.label} · ${PERIOD_LABELS[period]} · ${ownersList.find(owner => owner.id === selectedOwnerId)?.name || 'Todos os vendedores'} · ${productLabel}`}
        qualificationDates={metrics.leadQualificationDates} estimatedQualificationIds={metrics.estimatedQualificationIds} onClose={() => setSelection(null)} />}
      {selectedStage && metrics && <StageLeadsModal stage={selectedStage}
        qualificationDates={metrics.leadQualificationDates} estimatedQualificationIds={metrics.estimatedQualificationIds} onClose={() => setSelectedStageId(null)} />}
      </>}
    </div>
  );
};

export default ReportsPage;
