'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';
import { PeriodFilterSelect } from '@/components/filters/PeriodFilterSelect';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { analyticsDate, formatCount, formatRate, type BotAnalyticsResult } from './types';

const SELECT = 'h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

export function BotAnalyticsToolbar({ data, period, onPeriod, revision, onRevision, loading, onRefresh }: {
  data: BotAnalyticsResult | undefined;
  period: PeriodFilter;
  onPeriod: (period: PeriodFilter) => void;
  revision: string;
  onRevision: (revision: string) => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  return <section aria-label="Filtros das estatísticas" className="shrink-0 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-white/10 dark:bg-slate-950">
    <div className="flex flex-wrap items-center gap-3">
      <div className="mr-auto">
        <p className="text-sm font-semibold">Desempenho do robô</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">Execuções iniciadas no período · testes excluídos</p>
      </div>
      <PeriodFilterSelect value={period} onChange={onPeriod} className="w-44" aria-label="Período das estatísticas" />
      <select className={`${SELECT} max-w-60`} aria-label="Versão do fluxo" value={revision} onChange={e => onRevision(e.target.value)}>
        <option value="">Versão atual</option>
        {data?.revisions.map(item => <option key={item.id} value={item.id}>
          {analyticsDate(item.startedAt)} · {item.id.slice(0, 6)} · {formatCount(item.runs)} execuções
        </option>)}
      </select>
      <button type="button" onClick={onRefresh} disabled={loading} aria-label="Atualizar estatísticas" title="Atualizar estatísticas"
        className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">
        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
    {data && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs" aria-label="Resumo das execuções">
      {([
        ['Acionamentos', data.summary.runs],
        ['Leads/contatos únicos', data.summary.uniqueSubjects],
        ['Concluídas', data.summary.done],
        ['Em andamento', data.summary.running],
        ['Aguardando resposta', data.summary.waiting],
        ['Com erro', data.summary.errored],
        ['Canceladas', data.summary.cancelled],
      ] as const).map(([label, value]) => <div key={label}><span className="text-slate-500 dark:text-slate-400">{label} </span><strong className="tabular-nums">{formatCount(value)}</strong></div>)}
    </div>}
  </section>;
}

export function BotAnalyticsPanel({ data, loading, error, dirty, staleGraph = false, goalStepId, onGoal, onRetry }: {
  data: BotAnalyticsResult | undefined;
  loading: boolean;
  error: string | null;
  dirty: boolean;
  staleGraph?: boolean;
  goalStepId: string;
  onGoal: (stepId: string) => void;
  onRetry: () => void;
}) {
  return <aside aria-label="Detalhes das estatísticas" className="w-full shrink-0 overflow-y-auto border-t border-slate-200 bg-white p-4 text-xs dark:border-white/10 dark:bg-slate-950 md:w-[360px] md:border-l md:border-t-0 max-md:max-h-[45vh]">
    {error ? <div role="alert" className="rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-950/30 dark:text-red-300">
      <p>{error}</p><button type="button" onClick={onRetry} className="mt-2 font-semibold underline">Tentar novamente</button>
      {goalStepId && <button type="button" onClick={() => onGoal('')} className="ml-3 mt-2 font-semibold underline">Limpar objetivo</button>}
    </div> : loading && !data ? <p role="status" className="text-slate-500">Carregando estatísticas…</p> : data ? <>
      {dirty ? <p className="mb-4 rounded-lg bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Há alterações não salvas. Os números continuam referentes à versão salva e ficam ocultos no quadro até você salvar ou desfazer as alterações.</p>
        : staleGraph ? <p className="mb-4 rounded-lg bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">O robô foi atualizado desde que este editor foi aberto. Os números ficam somente na lista abaixo. Feche e abra o editor novamente para atualizar o quadro.</p>
          : !data.isCurrentRevision && <p className="mb-4 rounded-lg bg-slate-100 p-3 text-slate-600 dark:bg-slate-800 dark:text-slate-300">Você está consultando uma versão anterior. Os números estão listados abaixo; o quadro continua mostrando a configuração atual.</p>}
      {!data.measurementStartedAt ? <p className="mb-4 text-slate-500 dark:text-slate-400">A medição detalhada começa nas novas execuções após a ativação deste recurso. Nenhum acionamento medido ainda.</p>
        : <p className="mb-4 text-slate-500 dark:text-slate-400">Medição desde {analyticsDate(data.measurementStartedAt)} · apuração em {new Date(data.asOf).toLocaleString('pt-BR')}.</p>}
      {data.legacyRuns > 0 && <p className="mb-4 text-slate-500 dark:text-slate-400">{formatCount(data.legacyRuns)} execuções antigas preservadas, sem medição detalhada. Elas não entram nas taxas abaixo.</p>}
      <h3 className="font-semibold text-sm">Comparar caminhos</h3>
      <label className="mt-2 block space-y-1.5">
        <span className="text-slate-500 dark:text-slate-400">Objetivo: chegar a este bloco</span>
        <select aria-label="Bloco objetivo da comparação" value={goalStepId} onChange={e => onGoal(e.target.value)} className={`${SELECT} w-full`}>
          <option value="">Selecione um objetivo</option>
          {data.goalOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Cada lead conta uma vez por caminho. O objetivo precisa ser alcançado depois da distribuição, na mesma execução.</p>
      {data.variants.length > 0 ? <div className="mt-3 overflow-x-auto"><table className="w-full text-xs">
        <caption className="sr-only">Resultado por caminho de distribuição</caption>
        <thead><tr className="border-b border-slate-100 text-left text-[11px] text-slate-500 dark:border-slate-800"><th className="pb-2">Caminho</th><th className="pb-2 text-right">Leads</th><th className="pb-2 text-right">Objetivo</th><th className="pb-2 text-right">Taxa</th></tr></thead>
        <tbody>{data.variants.map(variant => <tr key={`${variant.stepId}:${variant.branchId}`} className="border-b border-slate-100 dark:border-slate-800">
          <th scope="row" className="py-2 text-left font-medium"><span>{variant.label}</span><span className="block text-[10px] font-normal text-slate-400">{data.steps.find(step => step.id === variant.stepId)?.label ?? 'Distribuição'}</span></th>
          <td className="py-2 text-right tabular-nums">{formatCount(variant.subjects)}</td>
          <td className="py-2 text-right tabular-nums">{variant.converted === null ? '—' : formatCount(variant.converted)}</td>
          <td className="py-2 text-right font-semibold tabular-nums">{variant.rate === null ? '—' : formatRate(variant.rate)}</td>
        </tr>)}</tbody>
      </table>{!data.goalStepId && <p className="mt-2 text-[11px] text-slate-500">Selecione um objetivo para calcular a taxa de cada caminho.</p>}</div>
        : <p className="mt-3 text-slate-500 dark:text-slate-400">Esta versão não tem distribuição de caminhos.</p>}
      <h3 className="mt-6 text-sm font-semibold">Passagem por bloco</h3>
      <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Participação no robô: execuções que chegaram ao bloco ÷ acionamentos. Saídas: execuções que seguiram por cada caminho ÷ chegadas ao bloco.</p>
      <div className="mt-3 space-y-2">
        {data.steps.map(step => <details key={step.id} className="rounded-lg border border-slate-200 dark:border-slate-800">
          <summary className="cursor-pointer px-3 py-2.5"><span className="inline-flex w-[calc(100%-1rem)] items-start justify-between gap-3 align-top"><span className="min-w-0 break-words font-medium">{step.label}</span><span className="shrink-0 tabular-nums text-primary-600 dark:text-primary-300">{formatCount(step.entered)} · {formatRate(step.percent)}</span></span></summary>
          <div className="space-y-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-800">
            {step.outputs.map(output => <div key={output.id} className="flex items-start justify-between gap-3"><span className="text-slate-600 dark:text-slate-400">{output.label}</span><span className="shrink-0 tabular-nums">{formatCount(output.count)} / {formatCount(step.entered)} · {formatRate(output.percent)}</span></div>)}
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Aguardando: {formatCount(step.waiting)} · Falhas: {formatCount(step.failed)} · Pulados: {formatCount(step.skipped)}</div>
          </div>
        </details>)}
        {data.summary.runs === 0 && <p className="py-3 text-slate-500 dark:text-slate-400">Nenhuma execução medida nesta versão e período.</p>}
      </div>
      <p className="mt-5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Repetições não aumentam os percentuais. Chegar a um bloco ou concluir o fluxo não significa que todas as ações foram executadas com sucesso; consulte também as falhas.</p>
    </> : null}
  </aside>;
}
