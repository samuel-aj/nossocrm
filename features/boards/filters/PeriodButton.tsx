import { FilterSelect, FILTER_PANEL, FILTER_INPUT } from './FilterControls';
import { FormCheckbox } from '@/components/ui/FormControls';
import React from 'react';
import { CalendarDays, Pin } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EMPTY_PERIOD, PERIOD_LABELS, periodRange, periodSchema } from './boardFilters';
import { BoardFilterControls } from './useBoardFilters';

const inputClass = FILTER_INPUT + " w-full";
export function FilterPin({ controls, group }: { controls: BoardFilterControls; group: 'period' | 'general' }) {
  const saved = controls.saved?.[group];
  const current = controls[group];
  const equal = !!saved && JSON.stringify(saved) === JSON.stringify(current);
  return <button type="button" disabled={!controls.ready || controls.saving}
    aria-pressed={equal}
    title={controls.loadError ? 'Falha ao carregar seu padrão. Reabra a página para tentar novamente.' : equal ? 'Desafixar seu padrão deste funil' : 'Fixar como seu padrão neste funil'}
    onClick={() => controls.pin({ [group]: equal ? null : current })}
    className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 ${equal ? 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
    <Pin size={13} className={equal ? 'fill-current' : ''} aria-hidden="true" />{equal ? 'Fixado' : 'Fixar'}
  </button>;
}
export function PeriodButton({ controls }: { controls: BoardFilterControls }) {
  const value = controls.period;
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [error, setError] = React.useState('');
  const update = (patch: Partial<typeof value>) => { setDraft(v => ({ ...v, ...patch })); setError(''); };
  const active = value.preset !== 'all';
  return <Popover open={open} onOpenChange={v => { setOpen(v); if (v) { setDraft(value); setError(''); } }}>
    <PopoverTrigger asChild><button type="button" aria-label="Filtrar por período" className={`flex h-[38px] items-center gap-2 rounded-lg border px-3 text-sm ${active ? 'border-primary-300 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : 'border-slate-200 bg-white/70 dark:border-slate-700 dark:bg-white/5'}`}>
      <CalendarDays size={15} /><span className="max-md:hidden">{active ? PERIOD_LABELS[value.preset] : 'Período'}</span>
      {controls.saved?.period && <Pin size={12} className="text-primary-600" />}
    </button></PopoverTrigger>
    <PopoverContent align="end" collisionPadding={12} aria-label="Período" className={FILTER_PANEL}>
      <div className="flex items-center gap-3 border-b border-slate-100 pb-3 dark:border-white/10"><h3 className="font-semibold">Período</h3><button type="button" onClick={() => { controls.setPeriod(EMPTY_PERIOD); setDraft(EMPTY_PERIOD); setError(''); }} className="text-xs text-primary-600 hover:underline">Limpar</button>      <FilterPin controls={{ ...controls, period: draft, pin: patch => {
        if (patch.period === null) { controls.pin(patch); return; }
        const result = periodSchema.safeParse(draft);
        if (!result.success) { setError(result.error.issues[0].message); return; }
        controls.setPeriod(result.data);
        controls.pin({ period: result.data });
      } }} group="period" /></div>
      <div className="grid grid-cols-2 gap-2">{Object.entries(PERIOD_LABELS).map(([key, label]) => <button key={key} type="button" aria-pressed={draft.preset === key}
        onClick={() => update({ preset: key as typeof draft.preset, ...(key === 'custom' && draft.preset !== 'all' ? periodRange(draft) : {}) })}
        className={`rounded-lg border px-3 py-2 text-left text-sm ${draft.preset === key ? 'border-primary-400 bg-primary-50 text-primary-700 dark:bg-primary-900/30' : 'border-slate-200 dark:border-slate-700 hover:border-primary-300'}`}>{label}</button>)}</div>
      {draft.preset === 'custom' && <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs">Data inicial<input type="date" value={draft.start} max={draft.end || undefined} onChange={e => update({ start: e.target.value })} className={inputClass} /></label>
        <label className="space-y-1 text-xs">Data final<input type="date" value={draft.end} min={draft.start || undefined} onChange={e => update({ end: e.target.value })} className={inputClass} /></label>
      </div>}
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Filtrar pela data de</legend><div className="flex gap-5">
        <FormCheckbox label="Criação" checked={draft.created} onChange={created => update({created})}><span className="text-sm">Criação</span></FormCheckbox>
        <FormCheckbox label="Encerramento" checked={draft.closed} onChange={closed => update({closed})}><span className="text-sm">Encerramento</span></FormCheckbox>
      </div></fieldset>
      {draft.created && draft.closed && <label className="block space-y-1 text-xs">Combinar as datas<FilterSelect label="Combinar as datas" value={draft.logic} onChange={logic => update({logic: logic as 'AND' | 'OR'})} options={[{value:'AND',label:'As duas datas no período (E)'},{value:'OR',label:'Qualquer uma das datas no período (OU)'}]} /></label>}
      <p className="text-xs text-slate-500">Encerramento considera ganhos e perdas. O status escolhido em Filtros também é aplicado.</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={() => { const result = periodSchema.safeParse(draft); if (!result.success) { setError(result.error.issues[0].message); return; } controls.setPeriod(result.data); setOpen(false); }} className="w-full rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Aplicar período</button>

    </PopoverContent>
  </Popover>;
}
