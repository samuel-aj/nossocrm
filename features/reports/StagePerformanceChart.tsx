import React, { useId } from 'react';
import { Portal as TooltipPortal } from '@radix-ui/react-tooltip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface StageConversionData {
  stageId: string;
  name: string;
  count: number;
  fill: string;
  conversionRate?: number | null;
  populationLabel?: string;
  comparisonBase?: string;
  conversionLabel?: string;
  countingMethod?: 'reached_or_beyond';
  milestone?: 'qualification' | 'customer';
  milestoneLabel?: string;
  role?: 'postcustomer';
}

interface StageConversionChartProps {
  data: StageConversionData[];
  onStageClick?: (stageId: string) => void;
  description?: string;
}

const PLOT_HEIGHT = 208;
const LABEL_SPACE = 28;

/** Columns start at zero; their buttons retain the exact underlying count. */
export function StageConversionChart({ data, onStageClick, description = 'Quantidade de leads distintos. Selecione uma etapa para ver os registros.' }: StageConversionChartProps) {
  const descriptionId = useId();
  const maximum = Math.max(1, ...data.map(stage => stage.count));
  const roughStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = Math.max(1, ([1, 2, 5, 10].find(value => value * magnitude >= roughStep) || 10) * magnitude);
  const axisMaximum = Math.ceil(maximum / step) * step;
  const ticks = Array.from({ length: Math.round(axisMaximum / step) + 1 }, (_, index) => index * step);
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-500">Nenhuma etapa disponível para esta visão.</p>;
  return (
    <figure aria-label="Negócios por etapa" className="w-full min-w-0">
      <figcaption className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        {description}
      </figcaption>
      <div className="flex min-w-0 gap-2">
        <div aria-hidden="true" className="relative w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-400 dark:text-slate-500" style={{ height: PLOT_HEIGHT + LABEL_SPACE }}>
          {ticks.map(tick => <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: LABEL_SPACE + PLOT_HEIGHT * (1 - tick / axisMaximum) }}>{tick.toLocaleString('pt-BR')}</span>)}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-2">
          <div className="relative" style={{ minWidth: data.length * 92 }}>
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0" style={{ top: LABEL_SPACE, height: PLOT_HEIGHT }}>
              {ticks.map(tick => <span key={tick} className={`absolute inset-x-0 border-t ${tick === 0 ? 'border-slate-300 dark:border-slate-600' : 'border-dashed border-slate-200 dark:border-slate-700/70'}`} style={{ top: `${(1 - tick / axisMaximum) * 100}%` }} />)}
            </div>
            <TooltipProvider delayDuration={150}>
              <div className="relative grid gap-2 px-1" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
                {data.map((stage, index) => {
                  const percentage = stage.conversionRate == null ? null : `${stage.conversionRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
                  const comparison = percentage === null ? '' : `${percentage} · ${stage.conversionLabel || 'conversão'}${stage.comparisonBase ? ` · ${stage.comparisonBase}` : ''}`;
                  const description = [comparison, stage.populationLabel].filter(Boolean).join('. ');
                  const height = stage.count / axisMaximum * PLOT_HEIGHT;
                  return <Tooltip key={stage.stageId}>
                    <TooltipTrigger asChild>
                      <button type="button" disabled={!onStageClick} onClick={() => onStageClick?.(stage.stageId)}
                        aria-label={`Ver ${stage.count} leads em ${stage.name}${stage.countingMethod === 'reached_or_beyond' && !stage.milestone ? ' ou além' : ''}`} aria-describedby={description ? `${descriptionId}-${index}` : undefined}
                        className="group flex min-w-0 flex-col items-stretch rounded-lg pb-2 text-center hover:bg-slate-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 disabled:cursor-default">
                        <span className="relative block shrink-0" style={{ height: PLOT_HEIGHT + LABEL_SPACE }}>
                          <span className="absolute inset-x-0 text-sm font-semibold tabular-nums leading-5 text-slate-900 dark:text-white" style={{ bottom: height + 5 }}>{stage.count.toLocaleString('pt-BR')}</span>
                          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 mx-auto block w-3/5 max-w-14 rounded-t-md group-hover:brightness-110" style={{ height, backgroundColor: stage.fill }} />
                        </span>
                        <span className="mt-3 block px-1 text-[11px] leading-4 font-medium text-slate-700 dark:text-slate-200 break-words [overflow-wrap:anywhere]">{stage.name}</span>
                        {(stage.milestone || stage.role) && <span className="mt-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">{stage.milestoneLabel || (stage.milestone === 'qualification' ? 'MQL · Qualificados' : stage.milestone === 'customer' ? 'Cliente · Ganhos' : 'Pós-venda')}</span>}
                        {percentage !== null && <span aria-hidden="true" className="mt-1 text-[10px] leading-4 tabular-nums text-slate-500 dark:text-slate-400">{percentage}</span>}
                        {description && <span id={`${descriptionId}-${index}`} className="sr-only">{description}</span>}
                      </button>
                    </TooltipTrigger>
                    <TooltipPortal><TooltipContent side="top" className="max-w-64 border-slate-700 bg-slate-900 text-slate-100 shadow-lg px-3 py-2 text-xs leading-5">
                      <p className="font-semibold break-words">{stage.name} · {stage.count.toLocaleString('pt-BR')} leads</p>
                      {comparison && <p>{comparison}</p>}
                      {stage.populationLabel && <p className="text-slate-300">{stage.populationLabel}</p>}
                    </TooltipContent></TooltipPortal>
                  </Tooltip>;
                })}
              </div>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </figure>
  );
}

export default StageConversionChart;
