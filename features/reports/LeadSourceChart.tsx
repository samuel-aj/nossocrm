import React, { useId } from 'react';
import { ArrowUpRight, PieChart } from 'lucide-react';
import type { PerformanceMode } from './performanceHistory';
import { LEAD_SOURCE_BASE, LEAD_SOURCE_HISTORY_NOTE, leadSourceSlices, type LeadSourceGroup } from './leadSourceReport';
import { formatReportRate } from './reportPresentation';

interface Props {
  groups: LeadSourceGroup[]; total: number; mode: PerformanceMode; legacySnapshotCount: number;
  onSelect: (keys?: string[]) => void;
}
export function LeadSourceChart({ groups, total, mode, legacySnapshotCount, onSelect }: Props) {
  const titleId = useId();
  const slices = leadSourceSlices(groups);
  let offset = 0;
  return <section aria-labelledby={titleId} className="glass min-w-0 border border-slate-200 dark:border-white/5 rounded-xl p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white"><PieChart size={18} className="text-primary-500" aria-hidden="true" />Origem dos leads</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">{LEAD_SOURCE_BASE[mode]}</p>
      </div>
      {total > 0 && <button type="button" onClick={() => onSelect()} className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline focus-visible:ring-2 focus-visible:ring-primary-500">Ver todas as origens<ArrowUpRight size={14} aria-hidden="true" /></button>}
    </div>
    {!total ? <p className="py-12 text-center text-sm text-slate-500">Nenhum lead nesta base para distribuir por origem.</p> : <div className="grid items-center gap-4 mt-4 sm:grid-cols-[160px_1fr] lg:grid-cols-1 2xl:grid-cols-[140px_1fr]">
      <div className="relative mx-auto w-40 h-40 2xl:w-36 2xl:h-36">
        <svg viewBox="0 0 200 200" className="w-full h-full overflow-visible" role="group" aria-label={`Distribuição de ${total} leads por origem`}>
          {slices.map(slice => {
            const start = offset;
            offset += slice.percentage;
            const label = `${slice.label}: ${slice.count} ${slice.count === 1 ? 'lead' : 'leads'}, ${formatReportRate(slice.percentage)}`;
            return <circle key={slice.key} cx="100" cy="100" r="76" fill="none" stroke={slice.color} strokeWidth="28" pathLength="100"
              strokeDasharray={`${slice.percentage} ${100 - slice.percentage}`} strokeDashoffset={-start} transform="rotate(-90 100 100)"
              role="button" tabIndex={0} aria-label={`Ver ${label}`} className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500 hover:opacity-80"
              onClick={() => onSelect(slice.sourceKeys)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(slice.sourceKeys); } }}><title>{label}</title></circle>;
          })}
        </svg>
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center"><span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{total.toLocaleString('pt-BR')}</span><span className="text-xs text-slate-500 dark:text-slate-400">leads na base</span></div>
      </div>
      <ul className="space-y-1" aria-label="Origens e participação na base">
        {slices.map(slice => <li key={slice.key}><button type="button" onClick={() => onSelect(slice.sourceKeys)} aria-label={`Detalhar ${slice.label}: ${slice.count} ${slice.count === 1 ? 'lead' : 'leads'}, ${formatReportRate(slice.percentage)}`}
          className="group flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary-500">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
          <span className="min-w-0 flex-1 text-xs text-slate-700 dark:text-slate-200 break-words">{slice.label}</span>
          <span className="text-sm shrink-0 font-semibold tabular-nums text-slate-900 dark:text-white">{slice.count.toLocaleString('pt-BR')}</span>
          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{formatReportRate(slice.percentage)}</span>
          <ArrowUpRight size={13} aria-hidden="true" className="text-slate-400 group-hover:text-primary-500" />
        </button></li>)}
      </ul>
    </div>}
    {total > 0 && <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Cada lead conta uma vez. Não informado faz parte do total.{mode !== 'current' && ' A origem considerada é a registrada na entrada no funil.'}</p>}
    {legacySnapshotCount > 0 && <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">{legacySnapshotCount} {legacySnapshotCount === 1 ? 'lead tem origem histórica reconstruída ou indisponível' : 'leads têm origem histórica reconstruída ou indisponível'}. {LEAD_SOURCE_HISTORY_NOTE}</p>}
  </section>;
}
