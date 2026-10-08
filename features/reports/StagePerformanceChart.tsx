import React from 'react';

interface StageConversionData {
  stageId: string;
  name: string;
  count: number;
  fill: string;
  conversionRate?: number | null;
  populationLabel?: string;
  comparisonBase?: string;
  conversionLabel?: string;
}

interface StageConversionChartProps {
  data: StageConversionData[];
  onStageClick?: (stageId: string) => void;
}

/** Bars and their exact quantities share the same accessible control. */
export function StageConversionChart({ data, onStageClick }: StageConversionChartProps) {
  const maximum = Math.max(1, ...data.map(stage => stage.count));
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-500">Nenhuma etapa disponível para esta visão.</p>;
  return (
    <figure aria-label="Negócios por etapa" className="w-full space-y-2">
      <figcaption className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Quantidade de leads distintos. Selecione uma etapa para ver os registros.
      </figcaption>
      {data.map(stage => {
        const percentage = stage.conversionRate == null ? null : `${stage.conversionRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
        return (
          <button key={stage.stageId} type="button" disabled={!onStageClick}
            onClick={() => onStageClick?.(stage.stageId)}
            aria-label={`Ver ${stage.count} leads em ${stage.name}`}
            className="w-full rounded-lg px-2 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-default">
            <span className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(120px,1fr)_minmax(100px,2fr)_auto] items-center gap-x-4 gap-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200 break-words">{stage.name}</span>
              <span aria-hidden="true" className="hidden sm:block h-5 rounded bg-slate-100 dark:bg-white/5 overflow-hidden">
                <span className="block h-full rounded" style={{ width: `${stage.count / maximum * 100}%`, backgroundColor: stage.fill }} />
              </span>
              <span className="min-w-8 text-right text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{stage.count}</span>
            </span>
            {percentage !== null && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              {percentage} · {stage.conversionLabel || 'conversão'}{stage.comparisonBase ? ` · ${stage.comparisonBase}` : ''}
            </span>}
          </button>
        );
      })}
    </figure>
  );
}

export default StageConversionChart;
