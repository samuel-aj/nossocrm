import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { TrendingUp, Clock, Target, DollarSign, Trophy, Users, Download, Settings, ThumbsDown, UserX, CheckCircle2 } from 'lucide-react';
import { useDashboardMetrics, PeriodFilter, COMPARISON_LABELS } from '../dashboard/hooks/useDashboardMetrics';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import { LazyStageConversionChart, ChartWrapper } from '@/components/charts';
import { generateReportPDF } from './utils/generateReportPDF';
import { useCRM } from '@/context/CRMContext';
import { useAuth } from '@/context/AuthContext';

/**
 * Componente React `ReportsPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
const ReportsPage: React.FC = () => {
  const router = useRouter();
  const { boards, deals: allCrmDeals } = useCRM();
  const { profile } = useAuth();
  const [period, setPeriod] = useState<PeriodFilter>('this_month');
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');

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

  // Lista de vendedores únicos para o filtro
  const ownersList = useMemo(() => {
    const map = new Map<string, string>();
    for (const deal of allCrmDeals) {
      if (deal.ownerId && deal.owner?.name) {
        map.set(deal.ownerId, deal.owner.name);
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allCrmDeals]);

  // Pegar o board selecionado para acessar a meta
  const selectedBoard = useMemo(() => {
    return boards.find(b => b.id === selectedBoardId);
  }, [boards, selectedBoardId]);

  const {
    avgSalesCycle,
    fastestDeal,
    slowestDeal,
    wonDealsWithDates,
    actualWinRate,
    wonDeals,
    lostDeals,
    topLossReasons,
    topDeals,
    wonRevenue,
    pipelineValue,
    deals,
    changes,
    funnelData,
  } = useDashboardMetrics(period, selectedBoardId, selectedOwnerId || undefined);

  // Extrair meta do board selecionado
  const boardGoal = selectedBoard?.goal;
  const goalType = boardGoal?.type || 'currency';
  const goalTarget = parseFloat(boardGoal?.targetValue || '0') || 0;
  const goalKpi = boardGoal?.kpi || 'Receita';
  const hasGoal = goalTarget > 0;

  // Calcular valor atual baseado no tipo de meta (PADRÃO HUBSPOT/SALESFORCE)
  // Usa dados DO PERÍODO selecionado, não o total histórico
  const currentValue = React.useMemo(() => {
    switch (goalType) {
      case 'currency':
        // Receita GANHA no período
        return wonRevenue;
      case 'percentage':
        // Taxa de conversão do período
        return actualWinRate;
      case 'number':
      default:
        // Quantidade de deals GANHOS no período
        return wonDeals.length;
    }
  }, [goalType, wonRevenue, actualWinRate, wonDeals.length]);

  // Calcular Forecast
  const forecastPercent = hasGoal ? Math.min((currentValue / goalTarget) * 100, 100) : 0;
  const forecastGap = goalTarget - currentValue;
  const isOnTrack = forecastPercent >= 75;

  // Formatador baseado no tipo
  // Performance: keep formatter stable (prevents unnecessary child rerenders when passed down).
  const formatGoalValue = useCallback((value: number) => {
    switch (goalType) {
      case 'currency':
        if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}k`;
        return `R$ ${value.toLocaleString('pt-BR')}`;
      case 'number':
        return value.toFixed(0);
      case 'percentage':
        return `${value.toFixed(1)}%`;
      default:
        return value.toLocaleString();
    }
  }, [goalType]);

  // Calcular Performance por Vendedor (Leaderboard)
  const leaderboard = React.useMemo(() => {
    const repsMap: Record<string, { name: string; avatar: string; deals: number; revenue: number; winRate: number }> = {};

    wonDeals.forEach(deal => {
      const ownerKey = deal.owner?.name || 'unknown';
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

  // Dados de conversão por etapa (funil acumulativo)
  // Cada etapa conta os deals que estão nela + todos que já avançaram além dela + ganhos
  const stageConversionData = useMemo(() => {
    const wonCount = wonDeals.length;

    const accumulated = funnelData.map((stage, i) => {
      // Soma dos deals nesta etapa + todas posteriores + ganhos (que já saíram do funil)
      let reachedCount = wonCount;
      for (let j = i; j < funnelData.length; j++) {
        reachedCount += funnelData[j].count;
      }
      return { ...stage, count: reachedCount };
    });

    return accumulated.map((stage, i) => {
      const isLast = i === accumulated.length - 1;
      return {
        ...stage,
        conversionRate: !isLast && stage.count > 0
          ? (accumulated[i + 1].count / stage.count) * 100
          : stage.count > 0
            ? (wonCount / stage.count) * 100
            : 0,
        conversionLabel: isLast ? 'fecham' : 'avançam',
      };
    });
  }, [funnelData, wonDeals.length]);

  const generatedBy = useMemo(() => {
    if (profile?.first_name && profile?.last_name) return `${profile.first_name} ${profile.last_name}`;
    return profile?.first_name || profile?.email || 'Usuário';
  }, [profile?.email, profile?.first_name, profile?.last_name]);

  const handleExportPDF = useCallback(() => {
    generateReportPDF(
      {
        pipelineValue,
        actualWinRate,
        avgSalesCycle,
        fastestDeal,
        wonRevenue,
        wonDeals,
        changes,
        funnelData,
      },
      period,
      selectedBoard?.name,
      generatedBy
    );
  }, [
    actualWinRate,
    avgSalesCycle,
    changes,
    fastestDeal,
    funnelData,
    generatedBy,
    period,
    pipelineValue,
    selectedBoard?.name,
    wonDeals,
    wonRevenue,
  ]);

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] space-y-4">
      {/* Header com Filtros */}
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Relatórios de Performance
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Análise detalhada de vendas e tendências.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedBoardId}
            onChange={(e) => setSelectedBoardId(e.target.value)}
            aria-label="Selecionar Pipeline"
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {boards.map(board => (
              <option key={board.id} value={board.id}>{board.name}</option>
            ))}
          </select>

          <select
            value={selectedOwnerId}
            onChange={(e) => setSelectedOwnerId(e.target.value)}
            aria-label="Filtrar por Vendedor"
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">Todos os vendedores</option>
            {ownersList.map(owner => (
              <option key={owner.id} value={owner.id}>{owner.name}</option>
            ))}
          </select>

          <PeriodFilterSelect value={period} onChange={setPeriod} />

          <button
            type="button"
            onClick={handleExportPDF}
            className="group flex items-center gap-2 px-3 py-2 rounded-lg glass border border-slate-200/50 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:border-slate-300 dark:hover:border-white/20 transition-all duration-200"
            title="Exportar PDF"
          >
            <Download size={16} className="group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium opacity-80 group-hover:opacity-100">PDF</span>
          </button>
        </div>
      </div>

      {/* Forecast Bar - FEATURE #1 (80/20) */}
      {hasGoal ? (
        <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target className={`${isOnTrack ? 'text-emerald-500' : 'text-amber-500'}`} size={20} />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {goalKpi}
              </h3>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-xs text-slate-500">Realizado</span>
                <p className="text-lg font-bold text-emerald-500">{formatGoalValue(currentValue)}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500">Meta</span>
                <p className="text-lg font-bold text-slate-900 dark:text-white">{formatGoalValue(goalTarget)}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500">Gap</span>
                <p className={`text-lg font-bold ${forecastGap > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {forecastGap > 0 ? `-${formatGoalValue(forecastGap)}` : '✓ Atingido'}
                </p>
              </div>
            </div>
          </div>
          <div className="relative">
            <div className="w-full bg-slate-100 dark:bg-white/10 rounded-full h-4 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isOnTrack ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-amber-400 to-amber-500'
                  }`}
                style={{ width: `${forecastPercent}%` }}
              />
            </div>
            <div className="absolute top-0 right-0 h-4 flex items-center">
              <span className={`text-xs font-bold px-2 ${forecastPercent >= 50 ? 'text-white' : 'text-slate-600'}`}>
                {forecastPercent.toFixed(0)}%
              </span>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {isOnTrack
              ? `🎯 No ritmo! Faltam ${formatGoalValue(Math.abs(forecastGap))} para bater a meta.`
              : `⚠️ Atenção! Você está abaixo de 75% da meta. Faltam ${formatGoalValue(Math.abs(forecastGap))}.`
            }
          </p>
        </div>
      ) : (
        <div className="glass p-4 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <Settings className="text-amber-500" size={20} />
            <div className="flex-1">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Meta não configurada</h3>
              <p className="text-xs text-slate-500">Defina uma meta no board para acompanhar o forecast.</p>
            </div>
            <button
              onClick={() => router.push('/boards')}
              className="px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
            >
              Configurar
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        {/* Pipeline Value - FEATURE #2 */}
        <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <DollarSign className="text-blue-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Pipeline Total</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatCurrency(pipelineValue)}</p>
          <p className={`text-xs ${changes.pipeline >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {changes.pipeline >= 0 ? '+' : ''}{changes.pipeline.toFixed(1)}% {COMPARISON_LABELS[period]}
          </p>
        </div>

        {/* Win Rate */}
        <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Target className="text-emerald-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Win Rate</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{actualWinRate.toFixed(1)}%</p>
          <p className={`text-xs ${changes.winRate >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {changes.winRate >= 0 ? '+' : ''}{changes.winRate.toFixed(1)}% {COMPARISON_LABELS[period]}
          </p>
        </div>

        {/* Ciclo Médio */}
        <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Clock className="text-purple-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Ciclo Médio</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{avgSalesCycle} dias</p>
          <p className="text-xs text-slate-500">
            Rápido: {fastestDeal}d | Lento: {slowestDeal}d
          </p>
        </div>

        {/* Deals Fechados */}
        <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-orange-500/10">
              <TrendingUp className="text-orange-500" size={18} />
            </div>
            <span className="text-xs text-slate-500">Deals Fechados</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            <span className="text-emerald-500">{wonDeals.length}</span>
            <span className="text-slate-400 mx-1">/</span>
            <span className="text-red-500">{lostDeals.length}</span>
          </p>
          <p className="text-xs text-slate-500">
            Ganhos / Perdas
          </p>
        </div>
      </div>

      {/* Loss Analysis */}
      {lostDeals.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Loss by Category */}
          <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 mb-4">
              <ThumbsDown className="text-red-500" size={20} />
              Leads Perdidos
            </h2>
            {(() => {
              // Sem categoria gravada (perdas antigas) = "Sem classificação";
              // não dá pra afirmar que era qualificado só por ter motivo
              const qualified = lostDeals.filter(d => d.lossCategory === 'qualified');
              const disqualified = lostDeals.filter(d => d.lossCategory === 'disqualified');
              const noCategory = lostDeals.filter(d => !d.lossCategory);
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-500/20">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-orange-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Qualificados</span>
                    </div>
                    <span className="text-lg font-bold text-orange-600 dark:text-orange-400">{qualified.length}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-500/20">
                    <div className="flex items-center gap-2">
                      <UserX size={16} className="text-red-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Desqualificados</span>
                    </div>
                    <span className="text-lg font-bold text-red-600 dark:text-red-400">{disqualified.length}</span>
                  </div>
                  {noCategory.length > 0 && (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                      <span className="text-sm font-medium text-slate-500">Sem classificação</span>
                      <span className="text-lg font-bold text-slate-400">{noCategory.length}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-slate-200 dark:border-white/10 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-500">Total perdidos</span>
                    <span className="text-lg font-bold text-slate-900 dark:text-white">{lostDeals.length}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Top Loss Reasons */}
          <div className="lg:col-span-2 glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display mb-4">
              Motivos de Perda / Desqualificação
            </h2>
            {(() => {
              // Group all reasons with category info
              const reasonMap = new Map<string, { count: number; qualified: number; disqualified: number }>();
              for (const deal of lostDeals) {
                const reason = deal.lossReason || 'Não informado';
                const entry = reasonMap.get(reason) || { count: 0, qualified: 0, disqualified: 0 };
                entry.count++;
                // Sem categoria (perda antiga) não pontua em nenhum dos dois:
                // o motivo fica sem etiqueta em vez de virar QUALIF. por engano
                if (deal.lossCategory === 'disqualified') entry.disqualified++;
                else if (deal.lossCategory === 'qualified') entry.qualified++;
                reasonMap.set(reason, entry);
              }
              const sorted = [...reasonMap.entries()].sort((a, b) => b[1].count - a[1].count);
              const maxCount = sorted[0]?.[1].count || 1;

              return (
                <div className="space-y-2">
                  {sorted.map(([reason, data]) => (
                    <div key={reason} className="group">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{reason}</span>
                          {data.disqualified > 0 && data.qualified === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded font-bold shrink-0">DESQUAL.</span>
                          )}
                          {data.qualified > 0 && data.disqualified === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 rounded font-bold shrink-0">QUALIF.</span>
                          )}
                        </div>
                        <span className="text-sm font-bold text-slate-900 dark:text-white ml-2 shrink-0">{data.count}</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-white/5 rounded-full h-2">
                        <div
                          className="bg-red-500 h-2 rounded-full transition-all"
                          style={{ width: `${(data.count / maxCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {sorted.length === 0 && (
                    <p className="text-sm text-slate-500 italic text-center py-4">Nenhum motivo registrado.</p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Bottom Grid - Charts & Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-[250px]">
        {/* Stage Conversion Chart */}
        <div className="lg:col-span-2 glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col h-full">
          <div className="flex justify-between items-center mb-2 shrink-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
              Conversão por Etapa
            </h2>
            <span className="text-xs text-slate-500 bg-slate-100 dark:bg-white/5 px-2 py-1 rounded">
              Snapshot Atual
            </span>
          </div>
          <div className="flex-1 min-h-0 relative">
            <div className="absolute inset-0">
              <ChartWrapper height="100%">
                <LazyStageConversionChart data={stageConversionData} />
              </ChartWrapper>
            </div>
          </div>
        </div>

        {/* Leaderboard - FEATURE #3 (Top Performers) */}
        <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm flex flex-col h-full overflow-hidden">
          <div className="flex justify-between items-center mb-3 shrink-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
              <Trophy className="text-amber-500" size={20} />
              Top Vendedores
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
            {leaderboard.length > 0 ? (
              leaderboard.map((rep, index) => (
                <div
                  key={rep.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors"
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
                </div>
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
    </div>
  );
};

export default ReportsPage;
