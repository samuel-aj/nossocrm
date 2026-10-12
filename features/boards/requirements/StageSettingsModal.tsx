'use client';

import React, { useState } from 'react';
import { Check, ListChecks } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { useCRM } from '@/context/CRMContext';
import { useToast } from '@/context/ToastContext';
import { boardsService } from '@/lib/supabase/boards';
import { queryKeys } from '@/lib/query/queryKeys';
import { NATIVE_STAGE_FIELDS } from '@/lib/deals/stageRequirements';
import type { Board, BoardStage } from '@/types';

export function StageSettingsModal({ board, stage, onClose }: { board: Board; stage: BoardStage; onClose: () => void }) {
  const { customFieldDefinitions } = useCRM();
  const client = useQueryClient();
  const { addToast } = useToast();
  const [label, setLabel] = useState(stage.label);
  const [required, setRequired] = useState(stage.requiredFields ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fields = [
    ...NATIVE_STAGE_FIELDS,
    ...customFieldDefinitions.map(f => ({ id: `custom:${f.id}`, label: f.label, description: f.groupName || 'Campo personalizado' })),
  ];
  const unknown = required.filter(id => !fields.some(f => f.id === id));
  const toggle = (id: string) => setRequired(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  const save = async () => {
    if (busy || !label.trim()) return;
    setBusy(true); setError('');
    try {
      const patch = { label: label.trim(), requiredFields: required };
      const { error: failure } = await boardsService.updateStage(stage.id, patch);
      if (failure) throw failure;
      client.setQueryData<Board[]>(queryKeys.boards.lists(), old => old?.map(b => b.id === board.id
        ? { ...b, stages: b.stages.map(s => s.id === stage.id ? { ...s, ...patch } : s) } : b));
      void client.invalidateQueries({ queryKey: queryKeys.boards.all });
      addToast('Etapa atualizada', 'success'); onClose();
    } catch (e) { setError((e as Error).message || 'Não foi possível salvar a etapa.'); }
    finally { setBusy(false); }
  };
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Editar etapa" size="xl" footer={<div className="flex justify-end gap-2">
    <button type="button" disabled={busy} onClick={onClose} className="px-4 py-2 text-sm">Cancelar</button>
    <button type="submit" form="stage-settings" disabled={busy || !label.trim()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar etapa'}</button>
  </div>}>
    <form id="stage-settings" onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-6">
      <label className="block text-sm font-medium">Nome da etapa
        <input required maxLength={100} value={label} disabled={busy} onChange={e => setLabel(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-transparent p-3 dark:border-white/15" />
      </label>
      <section>
        <h3 className="flex items-center gap-2 font-semibold"><ListChecks size={18} className="text-primary-600" />Campos obrigatórios</h3>
        <p className="mt-1 mb-4 text-sm text-slate-500">Para entrar nesta etapa, o lead precisa ter os campos marcados preenchidos.</p>
        <div className="space-y-2">{fields.map(field => <label key={field.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${required.includes(field.id) ? 'border-primary-300 bg-primary-50/50 dark:bg-primary-900/10' : 'border-slate-200 dark:border-white/10'}`}>
          <input type="checkbox" checked={required.includes(field.id)} disabled={busy} onChange={() => toggle(field.id)} className="h-4 w-4 accent-primary-600" />
          <span className="flex-1"><span className="block text-sm font-semibold">{field.label}</span><span className="text-xs text-slate-500">{field.description}</span></span>
          {required.includes(field.id) && <Check size={16} className="text-primary-600" />}
        </label>)}</div>
        {unknown.map(id => <label key={id} className="mt-2 flex gap-2 text-sm text-amber-700"><input type="checkbox" checked disabled={busy} onChange={() => toggle(id)} />Campo indisponível — desmarque para remover a regra</label>)}
      </section>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-white/5">Ao mover um lead com pendências, o CRM pedirá o preenchimento. Cancelar mantém o lead na etapa anterior.</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  </Modal>;
}
