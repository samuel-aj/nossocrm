import React, { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, ThumbsDown } from 'lucide-react';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { Modal } from '@/components/ui/Modal';
import { useOrgPreferences } from '@/lib/query/hooks/useOrgPreferences';
import { useToast } from '@/context/ToastContext';
import { lossCategoryLabel, lossReasonLabel } from '@/lib/utils/lossDetails';
import { useUpdateLossDetails, type LossDetails } from './useUpdateLossDetails';
import type { Deal } from '@/types';

export function LossDetailsBanner({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<LossDetails['lossCategory'] | ''>('');
  const [reason, setReason] = useState('');
  const id = useId();
  const { lossReasonsQualified, lossReasonsDisqualified } = useOrgPreferences();
  const save = useUpdateLossDetails(deal, canEdit);
  const { addToast } = useToast();
  if (!deal.isLost || deal.isWon) return null;
  const color = deal.lossCategory === 'qualified'
    ? 'border-orange-300 dark:border-orange-500/40 bg-orange-50 dark:bg-orange-950/20 text-orange-800 dark:text-orange-300'
    : deal.lossCategory === 'disqualified'
      ? 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300'
      : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-slate-300';
  const hasDate = deal.closedAt && Number.isFinite(Date.parse(deal.closedAt));
  const reasons = category === 'qualified' ? lossReasonsQualified : lossReasonsDisqualified;
  return <>
    <section aria-label="Dados da perda" className={`mt-4 rounded-xl border border-l-4 p-3 sm:p-4 flex flex-wrap items-start justify-between gap-3 ${color}`}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <ThumbsDown size={18} aria-hidden="true" className="shrink-0 mt-0.5" />
        <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide">Perdido · {lossCategoryLabel(deal.lossCategory)}</p>
          <p className="mt-1 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words"><span className="font-semibold">Motivo: </span>{lossReasonLabel(deal.lossReason)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hasDate ? `Encerrado em ${new Date(deal.closedAt!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Data de encerramento não informada'}</p>
        </div>
      </div>
      {canEdit && <button type="button" onClick={() => { setCategory(deal.lossCategory || ''); setReason(deal.lossReason || ''); save.reset(); setEditing(true); }} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary-500"><Pencil size={13} aria-hidden="true" />Editar classificação e motivo</button>}
    </section>
    {editing && createPortal(<div onClick={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !event.defaultPrevented && !save.isPending) setEditing(false);
    }}><Modal isOpen onClose={() => { if (!save.isPending) setEditing(false); }} title="Editar dados da perda" className="max-w-lg">
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault();
        if (!category || !reason.trim() || save.isPending) return;
        try {
          const result = await save.mutateAsync({ lossCategory: category, lossReason: reason });
          setEditing(false);
          addToast(result.historyWarning ? 'Dados salvos, mas não foi possível registrar a correção na Timeline.' : 'Dados da perda atualizados.', result.historyWarning ? 'warning' : 'success');
        } catch { /* The form retains the draft and displays the mutation error. */ }
      }}>
        <p className="text-sm text-slate-500 dark:text-slate-400">{deal.title}</p>
        <fieldset disabled={save.isPending} className="space-y-4">
          <FilterSelect label="Classificação da perda" value={category} onChange={value => setCategory(value as typeof category)} options={[{ value: '', label: 'Selecione a classificação' }, { value: 'qualified', label: 'Qualificado' }, { value: 'disqualified', label: 'Desqualificado' }]} />
          <div><label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Motivo da perda</label>
            <input id={id} list={`${id}-reasons`} value={reason} onChange={event => setReason(event.target.value)} required maxLength={2000}
              className="w-full min-w-0 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500" />
            <datalist id={`${id}-reasons`}>{(reasons || []).map(value => <option key={value} value={value} />)}</datalist>
          </div>
        </fieldset>
        {save.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{save.error.message}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={save.isPending} onClick={() => setEditing(false)} className="px-3 py-2 text-sm rounded-lg text-slate-600 dark:text-slate-300">Cancelar</button>
          <button type="submit" disabled={!category || !reason.trim() || save.isPending} className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50">{save.isPending ? 'Salvando…' : 'Salvar alterações'}</button>
        </div>
      </form>
    </Modal></div>, document.body)}
  </>;
}
