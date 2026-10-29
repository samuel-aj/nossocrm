'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { BTN_ICON, HELP_CLASS, INPUT_CLASS, newId } from '../ui';
import type { BlockOfType, SplitBranchDraft } from './types';

/** Use whole percentages without losing the remainder (three branches = 34/33/33). */
export function equalSplitWeights(branches: SplitBranchDraft[]): SplitBranchDraft[] {
  const base = Math.floor(100 / branches.length);
  return branches.map((branch, index) => ({ ...branch, weight: base + (index < 100 % branches.length ? 1 : 0) }));
}

export function SplitEditor({ block, update }: {
  block: BlockOfType<'split'>;
  update: (block: BlockOfType<'split'>) => void;
}) {
  const { mode, branches } = block.data;
  const total = branches.reduce((sum, branch) => sum + branch.weight, 0);
  const setBranches = (next: SplitBranchDraft[]) => update({ ...block, data: { ...block.data, branches: next } });
  const change = (id: string, patch: Partial<SplitBranchDraft>) => setBranches(branches.map(branch => branch.id === id ? { ...branch, ...patch } : branch));
  const add = () => {
    const available = Array.from({ length: 20 }, (_, index) => String.fromCharCode(65 + index)).find(label => !branches.some(branch => branch.label === label));
    setBranches(equalSplitWeights([...branches, { id: newId(), label: available ?? `Saída ${branches.length + 1}`, weight: 1 }]));
  };
  return <div className="space-y-4">
    <label className="block space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
      <span>Modo de distribuição</span>
      <NativeSelect className={INPUT_CLASS} value={mode} aria-label="Modo de distribuição" onChange={event => update({ ...block, data: { ...block.data, mode: event.target.value as typeof mode } })}>
        <option value="round_robin">Alternado (round robin)</option>
        <option value="random">Aleatório por porcentagem</option>
      </NativeSelect>
    </label>
    <p className={HELP_CLASS}>{mode === 'round_robin' ? 'Cada novo lead vai para a próxima saída: A, B, C… e volta à primeira.' : 'Cada novo lead é sorteado conforme os percentuais. A proporção observada pode variar, especialmente com poucos leads.'} O mesmo lead mantém o caminho neste teste.</p>
    <div className="space-y-2">
      {branches.map((branch, index) => <div key={branch.id} className="flex items-end gap-2 rounded-lg border border-slate-200 p-2 dark:border-white/10">
        <label className="min-w-0 flex-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
          <span>Saída {index + 1}</span>
          <input className={INPUT_CLASS} aria-label={`Nome da saída ${index + 1}`} maxLength={60} value={branch.label} onChange={event => change(branch.id, { label: event.target.value })} />
        </label>
        {mode === 'random' && <label className="w-20 shrink-0 space-y-1 text-xs text-slate-600 dark:text-slate-300">
          <span>%</span>
          <input className={INPUT_CLASS} type="number" min={1} max={100} step={1} aria-label={`Porcentagem da saída ${index + 1}`} value={branch.weight} onChange={event => change(branch.id, { weight: Number(event.target.value) })} />
        </label>}
        <button type="button" className={`${BTN_ICON} mb-1 disabled:cursor-not-allowed disabled:opacity-30`} aria-label={`Remover saída ${index + 1}`} title={branches.length <= 2 ? 'Mantenha pelo menos duas saídas' : 'Remover saída'} disabled={branches.length <= 2} onClick={() => setBranches(equalSplitWeights(branches.filter(item => item.id !== branch.id)))}><Trash2 size={15} /></button>
      </div>)}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 disabled:opacity-40" disabled={branches.length >= 20} onClick={add}><Plus size={14} />Adicionar saída</button>
      {mode === 'random' && <button type="button" className="text-xs text-primary-600" onClick={() => setBranches(equalSplitWeights(branches))}>Dividir igualmente</button>}
      <span className="ml-auto text-xs text-slate-400">{branches.length}/20 saídas</span>
    </div>
    {mode === 'random' && <p role={total !== 100 ? 'alert' : undefined} className={`text-xs font-medium ${total !== 100 ? 'text-red-600' : 'text-emerald-600'}`}>Total: {total}%{total !== 100 ? ' — ajuste para 100% antes de salvar.' : ''}</p>}
    <p className={HELP_CLASS}>Ligue todas as saídas aos balões de destino para ativar o robô. Ao adicionar ou remover uma saída, as porcentagens são divididas igualmente.</p>
  </div>;
}
