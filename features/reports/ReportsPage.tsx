import { FilterSelect } from '@/components/filters/FilterSelect';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
const LazyStageConversionChart = dynamic(() => import('./StagePerformanceChart').then(module => module.StageConversionChart), { ssr: false });
import { TrendingUp, Clock, Target, DollarSign, Trophy, Users, Download, ThumbsDown, UserX, CheckCircle2 } from 'lucide-react';
import { getDateRange, PeriodFilter, PERIOD_LABELS, COMPARISON_LABELS } from '../dashboard/hooks/useDashboardMetrics';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import { ChartWrapper } from '@/components/charts';
import { generateReportPDF } from './utils/generateReportPDF';
import { useCRM } from '@/context/CRMContext';
import { useAuth } from '@/context/AuthContext';
import { performanceComparisonRange } from './performanceMetrics';
import { usePerformanceReport } from './usePerformanceReport';
import { StageLeadsModal } from './StageLeadsModal';
import { ReportLeadsModal } from './ReportLeadsModal';
import { NO_PRODUCT, lossReasonLabel, reportDrilldown, type ReportSelection } from './reportDrilldown';

/**
 * Componente React `ReportsPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
const ReportsPage: React.FC = () => {
  const { boards, deals: allCrmDeals, products = [] } = useCRM();
  const { profile } = useAuth();
  const [period, setPeriod] = useState<PeriodFilter>('this_month');
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selection, setSelection] = useState<ReportSelection | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  useEffect(() => { setSelectedStageId(null); setSelection(null); }, [period, selectedBoardId, selectedOwnerId, selectedProductId]);

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

  const range = useMemo(() => getDateRange(period), [period]);
  const comparisonRange = useMemo(() => performanceComparisonRange(range, period), [range, period]);
  const report = usePerformanceReport(selectedBoard, range, selectedOwnerId, comparisonRange, selectedProductId);
  const metrics = report.data;
  const productOptions = useMemo(() => {
    const options = new Map((metrics?.productOptions || []).map(product => [product.id, product.name]));
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

  const stageConversionData = metrics?.stageData || [];
  const selectedStage = stageConversionData.find(stage => stage.stageId === selectedStageId);
  const funnelRates = {
    total: metrics?.entries.length || 0, wonCount: wonDeals.length,
    qualified: metrics?.qualifiedCount || 0,
    hasQualifiedStage: metrics?.hasQualifiedStage || false,
    qualificationRate: metrics?.qualificationRate ?? null,
    conversionRate: metrics?.closingRate ?? null,
  };

  const generatedBy = useMemo(() => {
    if (profile?.first_name && profile?.last_name) return `${profile.first_name} ${profile.last_name}`;
    return profile?.first_name || profile?.email || 'Usuário';
  }, [profile?.email, profile?.first_name, profile?.last_name]);

  const handleExportPDF = useCallback(() => {
    if (!metrics || report.isFetching || report.isError) return;
    generateReportPDF(metrics, {
      boardName: selectedBoard?.name || '', period: PERIOD_LABELS[period],
      owner: ownersList.find(owner => owner.id === selectedOwnerId)?.name || 'Todos os vendedores', product: productLabel,
      range: range.start.toLocaleDateString('pt-BR') + ' a ' + range.end.toLocaleDateString('pt-BR'), generatedBy,
    });
  }, [metrics, report.isFetching, report.isError, selectedBoard, period, selectedOwnerId, ownersList, range, generatedBy, productLabel]);

  // Ranking de motivos (barra + contagem) usado pelos cards "Motivos de
  // Perda" e "Desqualificação" — cada card recebe só as perdas da sua
  // categoria, então aqui não há mais etiqueta misturando os dois mundos.
  const renderLossReasons = (dealsSubset: typeof lostDeals, barClass: string, category: 'qualified' | 'disqualified') => {
    const map = new Map<string, number>();
    for (const d of dealsSubset) {
      const reason = lossReasonLabel(d.lossReason);
      map.set(reason, (map.get(reason) || 0) + 1);
    }
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const maxCount = sorted[0]?.[1] || 1;
    if (sorted.length === 0) {
      return <p className="text-sm text-slate-500 italic text-center py-4">Nenhum motivo registrado.</p>;
    }
    return (
      <div className="space-y-2">
        {sorted.map(([reason, count]) => (
          <button key={reason} type="button" onClick={() => setSelection({ kind: 'loss', category, reason })}
            aria-label={`${reason}: ver ${count} leads`} className="block w-full text-left rounded-lg p-1 -m-1 hover:bg-slate-100 dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary-500">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{reason}</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white ml-2 shrink-0">{count}</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-white/5 rounded-full h-2">
              <div
                className={`${barClass} h-2 rounded-full transition-all`}
                style={{ width: `${(count / maxCount) * 100}%` }}
              />
            </div>
          </button>
        ))}
      </div>
    );
  };

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
        <div className="flex flex-wrap items-center justify-end gap-3 max-md:w-full">
          <div className="w-[340px] min-w-0 shrink-0 max-md:w-full"><FilterSelect label="Selecionar Pipeline" value={boardIdEfetivo} onChange={setSelectedBoardId} options={boards.map(board => ({value:board.id,label:board.name}))} /></div>

          <div className="w-[300px] min-w-0 shrink-0 max-md:w-full"><FilterSelect label="Filtrar por Vendedor" value={selectedOwnerId} onChange={setSelectedOwnerId} options={[{value:'',label:'Todos os vendedores'}, ...ownersList.map(owner => ({value:owner.id,label:owner.name}))]} /></div>

          <div className="w-[300px] min-w-0 shrink-0 max-md:w-full"><FilterSelect label="Filtrar por Produto" value={selectedProductId} onChange={setSelectedProductId} options={[{ value: '', label: 'Todos os produtos' }, { value: NO_PRODUCT, label: 'Sem produto' }, ...productOptions]} /></div>

          <PeriodFilterSelect value={period} onChange={setPeriod} />

          <button
            type="button"
            disabled={!metrics || report.isFetching || report.isError}
            onClick={handleExportPDF}
            className="group flex items-center gap-2 px-3 py-2 rounded-lg glass border border-slate-200/50 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/20 transition-all duration-200"
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

        {/* Taxa de Qualificação = qualificados ÷ total de leads do funil */}
        <button type="button" onClick={() => setSelection({ kind: 'qualification' })} className="glass text-left p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm hover:border-primary-400 dark:hover:border-primary-500/50 focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Target className="text-emerald-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Taxa de Qualificação</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {funnelRates.qualificationRate !== null ? `${funnelRates.qualificationRate.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '--'}
          </p>
          <p className="text-xs text-slate-500">
            {funnelRates.hasQualifiedStage
              ? `${funnelRates.qualified} qualificados de ${funnelRates.total} leads`
              : 'Board sem etapa "Qualificado"'}
          </p>
        </button>

        {/* Taxa de Conversão = ganhos ÷ qualificados */}
        <button type="button" onClick={() => setSelection({ kind: 'closing' })} className="glass text-left p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm hover:border-primary-400 dark:hover:border-primary-500/50 focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-teal-500/10">
              <TrendingUp className="text-teal-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Taxa de Fechamento</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {funnelRates.conversionRate !== null ? `${funnelRates.conversionRate.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '--'}
          </p>
          <p className="text-xs text-slate-500">
            {funnelRates.hasQualifiedStage
              ? `${funnelRates.wonCount} ganhos de ${funnelRates.qualified} qualificados`
              : 'Pipeline sem etapa de qualificação'}
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
            <span className="text-emerald-500">{wonDeals.length}</span>
            <span className="text-slate-400 mx-1">/</span>
            <span className="text-red-500">{lostDeals.filter(deal => deal.lossCategory === 'qualified').length}</span>
          </p>
          <p className="text-xs text-slate-500">
            Ganhos / Perdas qualificadas
          </p>
        </button>
      </div>

      {/* Fileira: Leads Perdidos + Conversão por Etapa lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Loss by Category */}
        {lostDeals.length > 0 && (
          <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 mb-4">
              <ThumbsDown className="text-red-500" size={20} />
              Perdas no Período
            </h2>
            {(() => {
              // Sem categoria gravada (perdas antigas) = "Sem classificação";
              // não dá pra afirmar que era qualificado só por ter motivo
              const qualified = lostDeals.filter(d => d.lossCategory === 'qualified');
              const disqualified = lostDeals.filter(d => d.lossCategory === 'disqualified');
              const noCategory = lostDeals.filter(d => !d.lossCategory);
              return (
                <div className="space-y-3">
                  <button type="button" onClick={() => setSelection({ kind: 'loss', category: 'qualified' })} className="w-full text-left focus-visible:ring-2 focus-visible:ring-primary-500 hover:brightness-110 flex items-center justify-between p-3 rounded-lg bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-500/20">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-orange-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Qualificados</span>
                    </div>
                    <span className="text-lg font-bold text-orange-600 dark:text-orange-400">{qualified.length}</span>
                  </button>
                  <button type="button" onClick={() => setSelection({ kind: 'loss', category: 'disqualified' })} className="w-full text-left focus-visible:ring-2 focus-visible:ring-primary-500 hover:brightness-110 flex items-center justify-between p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-500/20">
                    <div className="flex items-center gap-2">
                      <UserX size={16} className="text-red-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Desqualificados</span>
                    </div>
                    <span className="text-lg font-bold text-red-600 dark:text-red-400">{disqualified.length}</span>
                  </button>
                  {noCategory.length > 0 && (
                    <button type="button" onClick={() => setSelection({ kind: 'loss', category: 'unknown' })} className="w-full text-left focus-visible:ring-2 focus-visible:ring-primary-500 flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                      <span className="text-sm font-medium text-slate-500">Sem classificação</span>
                      <span className="text-lg font-bold text-slate-400">{noCategory.length}</span>
                    </button>
                  )}
                  <button type="button" onClick={() => setSelection({ kind: 'loss' })} className="w-full text-left focus-visible:ring-2 focus-visible:ring-primary-500 pt-2 border-t border-slate-200 dark:border-white/10 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-500">Total perdidos</span>
                    <span className="text-lg font-bold text-slate-900 dark:text-white">{lostDeals.length}</span>
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* Conversão por Etapa: ao lado de Leads Perdidos (ocupa a fileira
            inteira quando não há perdas pra mostrar) */}
        <div
          className={`glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col min-h-[320px] ${
            lostDeals.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'
          }`}
        >
          <div className="flex justify-between items-center mb-2 shrink-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Avanços por Etapa no Período
            </h2>
            <span className="text-xs text-slate-500 bg-slate-100 dark:bg-white/5 px-2 py-1 rounded">
              Por criação · Ganhos por encerramento
            </span>
          </div>
          {/* max-md:min-h: gráfico absolute colapsava quando o grid empilha */}
          <div className="flex-1 min-h-0 relative max-md:min-h-[280px]">
            <div className="absolute inset-0">
              <ChartWrapper height="100%">
                <LazyStageConversionChart data={stageConversionData} onStageClick={setSelectedStageId} />
              </ChartWrapper>
            </div>
          </div>
        </div>
      </div>

      {/* Fileira de baixo: Motivos de Perda + Desqualificação (+ Top Vendedores) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-[250px]">
        {/* Motivos de Perda: perdas QUALIFICADAS (+ antigas sem categoria,
            que nasceram antes da classificação existir) */}
        {lostDeals.length > 0 && (
          <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 mb-4">
              <CheckCircle2 className="text-orange-500" size={20} />
              Motivos de Perda — Qualificados
            </h2>
            {renderLossReasons(
              lostDeals.filter(d => d.lossCategory === 'qualified'),
              'bg-orange-500', 'qualified'
            )}
          </div>
        )}

        {/* Desqualificação: perdas DESQUALIFICADAS (lead fora do perfil) */}
        {lostDeals.length > 0 && (
          <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 mb-4">
              <UserX className="text-red-500" size={20} />
              Desqualificação
            </h2>
            {renderLossReasons(
              lostDeals.filter(d => d.lossCategory === 'disqualified'),
              'bg-red-500', 'disqualified'
            )}
          </div>
        )}

        {/* Leaderboard - FEATURE #3 (Top Performers) */}
        <div
          className={`glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col h-full overflow-hidden ${
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
        filtersLabel={`${selectedBoard.name} · ${PERIOD_LABELS[period]} · ${ownersList.find(owner => owner.id === selectedOwnerId)?.name || 'Todos os vendedores'} · ${productLabel}`}
        qualificationDates={metrics.leadQualificationDates} estimatedQualificationIds={metrics.estimatedQualificationIds} onClose={() => setSelection(null)} />}
      {selectedStage && metrics && <StageLeadsModal stage={selectedStage}
        qualificationDates={metrics.leadQualificationDates} estimatedQualificationIds={metrics.estimatedQualificationIds} onClose={() => setSelectedStageId(null)} />}
      </>}
    </div>
  );
};

export default ReportsPage;
