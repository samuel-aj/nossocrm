import React from 'react';
import { CalendarDays, Pin } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EMPTY_PERIOD, PERIOD_LABELS, periodRange, periodSchema } from './boardFilters';
import { BoardFilterControls } from './useBoardFilters';

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500';
export function FilterPin({ controls, group }: { controls: BoardFilterControls; group: 'period' | 'general' }) {
  const saved = controls.saved?.[group];
  const current = controls[group];
  const equal = !!saved && JSON.stringify(saved) === JSON.stringify(current);
  return <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-700">
    <p className="text-xs text-slate-500">Padrão só para você, neste funil.</p>
    {controls.loadError && <p role="alert" className="text-xs text-red-600">Não foi possível carregar seu padrão. Reabra a página para tentar novamente.</p>}
    <div className="flex items-center gap-3">
      <button type="button" disabled={!controls.ready || controls.saving || equal} onClick={() => controls.pin({ [group]: current })}
        className="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        <Pin size={14} />{equal ? 'Padrão fixado' : saved ? 'Atualizar padrão' : group === 'period' ? 'Fixar período' : 'Fixar filtros'}
      </button>
      {saved && <button type="button" disabled={controls.saving} onClick={() => controls.pin({ [group]: null })} className="text-xs text-slate-500 hover:text-primary-600">Desafixar</button>}
    </div>
  </div>;
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
    <PopoverContent align="end" className="max-h-[calc(100dvh-100px)] w-[min(420px,calc(100vw-24px))] overflow-y-auto space-y-4 rounded-xl p-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Período</h3><button type="button" onClick={() => { controls.setPeriod(EMPTY_PERIOD); setDraft(EMPTY_PERIOD); setError(''); }} className="text-xs text-primary-600">Limpar</button></div>
      <div className="grid grid-cols-2 gap-2">{Object.entries(PERIOD_LABELS).map(([key, label]) => <button key={key} type="button" aria-pressed={draft.preset === key}
        onClick={() => update({ preset: key as typeof draft.preset, ...(key === 'custom' && draft.preset !== 'all' ? periodRange(draft) : {}) })}
        className={`rounded-lg border px-3 py-2 text-left text-sm ${draft.preset === key ? 'border-primary-400 bg-primary-50 text-primary-700 dark:bg-primary-900/30' : 'border-slate-200 dark:border-slate-700 hover:border-primary-300'}`}>{label}</button>)}</div>
      {draft.preset === 'custom' && <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs">Data inicial<input type="date" value={draft.start} max={draft.end || undefined} onChange={e => update({ start: e.target.value })} className={inputClass} /></label>
        <label className="space-y-1 text-xs">Data final<input type="date" value={draft.end} min={draft.start || undefined} onChange={e => update({ end: e.target.value })} className={inputClass} /></label>
      </div>}
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Filtrar pela data de</legend><div className="flex gap-5">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.created} onChange={e => update({ created: e.target.checked })} className="h-4 w-4 accent-primary-600" />Criação</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.closed} onChange={e => update({ closed: e.target.checked })} className="h-4 w-4 accent-primary-600" />Encerramento</label>
      </div></fieldset>
      {draft.created && draft.closed && <label className="block space-y-1 text-xs">Combinar as datas<select value={draft.logic} onChange={e => update({ logic: e.target.value as 'AND' | 'OR' })} className={inputClass}>
        <option value="AND">As duas datas no período (E)</option><option value="OR">Qualquer uma das datas no período (OU)</option>
      </select></label>}
      <p className="text-xs text-slate-500">Encerramento considera ganhos e perdas. O status escolhido em Filtros também é aplicado.</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={() => { const result = periodSchema.safeParse(draft); if (!result.success) { setError(result.error.issues[0].message); return; } controls.setPeriod(result.data); setOpen(false); }} className="w-full rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Aplicar período</button>
      <FilterPin controls={{ ...controls, period: draft, pin: patch => {
        if (patch.period === null) { controls.pin(patch); return; }
        const result = periodSchema.safeParse(draft);
        if (!result.success) { setError(result.error.issues[0].message); return; }
        controls.setPeriod(result.data);
        controls.pin({ period: result.data });
      } }} group="period" />
    </PopoverContent>
  </Popover>;
}
