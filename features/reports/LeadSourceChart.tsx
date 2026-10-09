import React, { useId } from 'react';
import { ArrowUpRight, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { PerformanceMode } from './performanceHistory';
import { LEAD_SOURCE_BASE, LEAD_SOURCE_HISTORY_NOTE, UNKNOWN_LEAD_SOURCE_KEY, leadSourceSlices, type LeadSourceGroup } from './leadSourceReport';
import { formatReportRate } from './reportPresentation';

interface Props {
  groups: LeadSourceGroup[]; total: number; mode: PerformanceMode; legacySnapshotCount: number;
  onSelect: (keys?: string[]) => void;
}
const BASE_SUMMARY: Record<PerformanceMode, string> = {
  cohort: 'Leads captados no período selecionado',
  period: 'Entradas no funil no período selecionado',
  current: 'Distribuição dos negócios em aberto',
};

export function LeadSourceChart({ groups, total, mode, legacySnapshotCount, onSelect }: Props) {
  const titleId = useId();
  const slices = leadSourceSlices(groups).map(slice => ({
    ...slice,
    color: slice.key === 'overflow' ? '#f1a536' : slice.key === UNKNOWN_LEAD_SOURCE_KEY ? '#94a3b8' : slice.color,
  }));
  let offset = 0;
  return <section aria-labelledby={titleId} className="flex h-full min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/60 sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 id={titleId} className="text-[17px] font-semibold tracking-tight text-slate-900 dark:text-white">Origem dos leads</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{BASE_SUMMARY[mode]}</p>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Sobre a origem dos leads" className="shrink-0 rounded-full p-1 text-slate-400 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-500 dark:hover:text-primary-400"><Info size={18} aria-hidden="true" /></button>
        </PopoverTrigger>
        <PopoverContent align="end" className="max-w-[calc(100vw-2rem)] space-y-2 text-xs leading-5">
          <p className="font-semibold">Base do gráfico</p>
          <p>{LEAD_SOURCE_BASE[mode]}</p>
          <p>Cada lead conta uma vez. Não informado faz parte do total.{mode !== 'current' && ' A origem considerada é a registrada na entrada no funil.'}</p>
          {legacySnapshotCount > 0 && <>
            <p className="text-amber-700 dark:text-amber-300">{LEAD_SOURCE_HISTORY_NOTE}</p>
            <p className="text-amber-700 dark:text-amber-300">{legacySnapshotCount} {legacySnapshotCount === 1 ? 'lead tem origem histórica reconstruída ou indisponível' : 'leads têm origem histórica reconstruída ou indisponível'}.</p>
          </>}
        </PopoverContent>
      </Popover>
    </div>
    {!total ? <p className="py-12 text-center text-sm text-slate-500">Nenhum lead nesta base para distribuir por origem.</p> : <div className="flex flex-1 flex-col">
      <div className="relative mx-auto mb-4 mt-4 aspect-square w-[214px] max-w-full shrink-0 sm:w-[226px]">
        <svg viewBox="0 0 240 240" className="h-full w-full overflow-visible" role="group" aria-label={`Distribuição de ${total} leads por origem`}>
          {slices.map(slice => {
            const start = offset;
            offset += slice.percentage;
            const gap = slices.length > 1 ? Math.min(0.65, slice.percentage / 5) : 0;
            const label = `${slice.label}: ${slice.count} ${slice.count === 1 ? 'lead' : 'leads'}, ${formatReportRate(slice.percentage)}`;
            return <circle key={slice.key} cx="120" cy="120" r="93" fill="none" stroke={slice.color} strokeWidth="32" pathLength="100"
              strokeDasharray={`${slice.percentage - gap} ${100 - slice.percentage + gap}`} strokeDashoffset={-start} transform="rotate(-90 120 120)"
              role="button" tabIndex={0} aria-label={`Ver ${label}`} className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500 hover:opacity-80"
              onClick={() => onSelect(slice.sourceKeys)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(slice.sourceKeys); } }}><title>{label}</title></circle>;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="max-w-[132px] break-words text-center text-4xl font-semibold leading-tight tracking-tight tabular-nums text-slate-900 dark:text-white">{total.toLocaleString('pt-BR')}</span><span className="mt-1 text-xs text-slate-500 dark:text-slate-400">{total === 1 ? 'lead na base' : 'leads na base'}</span></div>
      </div>
      <ul className="mb-5 grid grid-cols-2 gap-x-4 gap-y-1" aria-label="Origens e participação na base">
        {slices.map(slice => <li key={slice.key} className="min-w-0"><button type="button" onClick={() => onSelect(slice.sourceKeys)} aria-label={`Detalhar ${slice.label}: ${slice.count} ${slice.count === 1 ? 'lead' : 'leads'}, ${formatReportRate(slice.percentage)}`}
          className="flex min-h-12 w-full items-start gap-2 rounded-lg py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-white/5">
          <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full ring-1 ring-black/5 dark:ring-white/10" style={{ backgroundColor: slice.color }} />
          <span className="min-w-0">
            <span className="block break-words text-xs leading-4 text-slate-600 dark:text-slate-300 [overflow-wrap:anywhere]">{slice.label}</span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
              <span>{slice.count.toLocaleString('pt-BR')} {slice.count === 1 ? 'lead' : 'leads'}</span>
              <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">{formatReportRate(slice.percentage)}</span>
            </span>
          </span>
        </button></li>)}
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-slate-100 pt-4 dark:border-white/10">
        <button type="button" aria-label="Ver todas as origens" onClick={() => onSelect()} className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400">Ver detalhes<ArrowUpRight size={13} aria-hidden="true" /></button>
      </div>
    </div>}
  </section>;
}
