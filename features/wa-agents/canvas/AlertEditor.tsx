'use client';

import type { BlockOfType } from './types';

export function AlertEditor({ block, update }: {
  block: BlockOfType<'activate_alert'>;
  update: (block: BlockOfType<'activate_alert'>) => void;
}) {
  const tone = block.data.tone ?? 'green';
  return <div className="space-y-4">
    <label className="grid gap-2 text-sm">Texto do alerta
      <input className="rounded-lg border p-2 dark:bg-slate-900" value={block.data.message} maxLength={300}
        onChange={e => update({ ...block, data: { ...block.data, message: e.target.value } })} />
    </label>
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Cor do alerta</legend>
      {(['green', 'red'] as const).map(value => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${value === 'red' ? 'border-red-200 text-red-700 dark:border-red-500/30 dark:text-red-200' : 'border-emerald-200 text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-200'}`}>
        <input type="radio" name={`alert-tone-${block.id}`} value={value} checked={tone === value}
          onChange={() => update({ ...block, data: { ...block.data, tone: value } })} />
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${value === 'red' ? 'bg-red-500' : 'bg-emerald-500'}`} />
        {value === 'red' ? 'Vermelho — Atenção' : 'Verde — Aviso'}
      </label>)}
    </fieldset>
    <p className="text-xs text-slate-500 dark:text-slate-400">Roxo/lavanda é reservado para a pausa da IA pelo controle de consumo.</p>
  </div>;
}
