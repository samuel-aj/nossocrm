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

// Cor do estágio (classe Tailwind gravada no board) → cor hex pro gráfico
const STAGE_COLOR_MAP: Record<string, string> = {
  'bg-blue-500': '#3b82f6',
  'bg-green-500': '#22c55e',
  'bg-yellow-500': '#eab308',
  'bg-orange-500': '#f97316',
  'bg-red-500': '#ef4444',
  'bg-purple-500': '#a855f7',
  'bg-pink-500': '#ec4899',
  'bg-indigo-500': '#6366f1',
  'bg-teal-500': '#14b8a6',
  'bg-slate-500': '#64748b',
};

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

  // Conversão por etapa (snapshot do board), com a semântica "quantos
  // CHEGARAM até aqui": barra = leads que alcançaram a etapa; % = dos que
  // chegaram, quantos avançaram pra seguinte (na última, quantos fecharam).
  // Ganhos contam como tendo passado por TODAS as etapas; perdidos contam só
  // na PRIMEIRA (entraram no funil; até onde avançaram não fica registrado).
  // Antes, os perdidos — por morarem na última coluna do board — contavam
  // como se tivessem chegado em tudo, e o gráfico dava ~100% em toda etapa.
  const stageConversionData = useMemo(() => {
    const convBoard = selectedBoard || boards[0];
    const stages = convBoard?.stages || [];
    if (stages.length === 0) return [];

    // Etapas FINAIS (Ganho/Perdido) são resultado, não passagem — saem do
    // funil de conversão; o fechamento vira a barra final "Ganho".
    const isWonStage = (label: string) => /^(ganh|won|vendid)/i.test(label.trim());
    const isLostStage = (label: string) => /^(perdid|lost)/i.test(label.trim());
    const midStages = stages.filter(s => !isWonStage(s.label) && !isLostStage(s.label));
    if (midStages.length === 0) return [];

    const boardDeals = allCrmDeals.filter(
      d => d.boardId === convBoard.id && (!selectedOwnerId || d.ownerId === selectedOwnerId)
    );
    const wonCount = boardDeals.filter(d => d.isWon).length;
    const lostCount = boardDeals.filter(d => d.isLost && !d.isWon).length;
    const openByStage = new Map<string, number>();
    for (const d of boardDeals) {
      if (d.isWon || d.isLost) continue;
      openByStage.set(d.status, (openByStage.get(d.status) || 0) + 1);
    }

    // chegaram(i) = abertos da etapa i em diante + ganhos; 1ª etapa inclui os perdidos
    const reached: number[] = new Array(midStages.length).fill(0);
    let acc = wonCount;
    for (let i = midStages.length - 1; i >= 0; i--) {
      acc += openByStage.get(midStages[i].id) || 0;
      reached[i] = acc;
    }
    reached[0] += lostCount;

    const items = midStages.map((s, i) => {
      const isLastMid = i === midStages.length - 1;
      const next = isLastMid ? wonCount : reached[i + 1];
      return {
        name: s.label,
        count: reached[i],
        fill: STAGE_COLOR_MAP[s.color] || '#3b82f6',
        conversionRate: reached[i] > 0 ? (next / reached[i]) * 100 : 0,
        conversionLabel: isLastMid ? 'fecham' : 'avançam',
      };
    });

    items.push({
      name: 'Ganho',
      count: wonCount,
      fill: '#22c55e',
      conversionRate: reached[0] > 0 ? (wonCount / reached[0]) * 100 : 0,
      conversionLabel: 'do total',
    });

    return items;
  }, [selectedBoard, boards, allCrmDeals, selectedOwnerId]);

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

  // Ranking de motivos (barra + contagem) usado pelos cards "Motivos de
  // Perda" e "Desqualificação" — cada card recebe só as perdas da sua
  // categoria, então aqui não há mais etiqueta misturando os dois mundos.
  const renderLossReasons = (dealsSubset: typeof lostDeals, barClass: string) => {
    const map = new Map<string, number>();
    for (const d of dealsSubset) {
      const reason = d.lossReason || 'Não informado';
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
          <div key={reason}>
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
          </div>
        ))}
      </div>
    );
  };

  return (
    // pb-6: respiro na base — sem ele os últimos cards colavam na borda
    // inferior da página (o container tem altura fixa no desktop)
    <div className="flex flex-col h-[calc(100vh-7rem)] max-md:h-auto space-y-4 pb-6">
      {/* Header com Filtros */}
      <div className="flex justify-between items-center shrink-0 max-md:flex-wrap max-md:gap-y-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
            Relatórios de Performance
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Análise detalhada de vendas e tendências.
          </p>
        </div>
        <div className="flex items-center gap-3 max-md:flex-wrap max-md:w-full">
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

          {/* Motivos de Perda: perdas QUALIFICADAS (+ antigas sem categoria,
              que nasceram antes da classificação existir) */}
          <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 mb-4">
              <CheckCircle2 className="text-orange-500" size={20} />
              Motivos de Perda
            </h2>
            {renderLossReasons(
              lostDeals.filter(d => d.lossCategory !== 'disqualified'),
              'bg-orange-500'
            )}
          </div>

          {/* Desqualificação: perdas DESQUALIFICADAS (lead fora do perfil) */}
          <div className="glass p-5 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2 mb-4">
              <UserX className="text-red-500" size={20} />
              Desqualificação
            </h2>
            {renderLossReasons(
              lostDeals.filter(d => d.lossCategory === 'disqualified'),
              'bg-red-500'
            )}
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
          {/* max-md:min-h: gráfico absolute colapsava quando o grid empilha */}
          <div className="flex-1 min-h-0 relative max-md:min-h-[280px]">
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

      {/* Espaçador REAL depois do último bloco: quando o conteúdo transborda
          a altura fixa do container, padding no root não aparece (fica no
          limite nominal da caixa, não abaixo do conteúdo transbordado) —
          este elemento garante a margem inferior em qualquer cenário */}
      <div className="shrink-0 h-2" aria-hidden="true" />
    </div>
  );
};

export default ReportsPage;
