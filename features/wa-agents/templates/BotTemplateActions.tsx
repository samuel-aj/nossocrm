'use client';
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import type { BotInput } from '@/lib/wa-agents/types';
import type { BotTemplate } from '@/lib/wa-agents/botTemplates';
import { waAgentsFetch } from '../useWaAgents';
import { BTN_SECONDARY, BTN_PRIMARY, INPUT_CLASS, Field, errorMessage } from '../ui';
import { BOT_TEMPLATES_KEY, useBotTemplates } from './useBotTemplates';
export function BotTemplateActions({ getInput }: { getInput: () => BotInput }) {
  const { showToast } = useToast(); const qc = useQueryClient();
  const [open, setOpen] = useState(false); const [name, setName] = useState('');
  const [description, setDescription] = useState(''); const [official, setOfficial] = useState(false); const [busy, setBusy] = useState(false);
  const library = useBotTemplates(open);
  async function exportJson() {
    setBusy(true);
    try {
      const { snapshot } = await waAgentsFetch<{ snapshot: BotTemplate }>('/api/wa-agents/bot-templates', { method: 'POST', body: { action: 'export', bot: getInput() } });
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'modelo-robo.json'; anchor.click(); URL.revokeObjectURL(url);
      showToast('Modelo exportado. Webhooks e vínculos precisam ser configurados no destino.', 'success');
    } catch (err) { showToast(errorMessage(err, 'Falha ao exportar'), 'error'); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try {
      await waAgentsFetch('/api/wa-agents/bot-templates', { method: 'POST', body: { action: 'save', bot: getInput(), name, description, official } });
      await qc.invalidateQueries({ queryKey: BOT_TEMPLATES_KEY }); setOpen(false);
      showToast(official ? 'Modelo oficial salvo como rascunho. Publique na biblioteca.' : 'Modelo salvo na biblioteca da organização.', 'success');
    } catch (err) { showToast(errorMessage(err, 'Falha ao salvar modelo'), 'error'); } finally { setBusy(false); }
  }
  return <>
    <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => { setName(getInput().name); setOpen(true); }}>Salvar como modelo</button>
    <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void exportJson()}>Exportar JSON</button>
    <Modal isOpen={open} onClose={() => setOpen(false)} title="Salvar como modelo" size="md">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}>
        <p className="text-sm text-slate-500">Salva uma cópia do fluxo atual. Segredos e configuração de webhooks são removidos. Os robôs existentes continuam independentes.</p>
        <Field label="Nome" htmlFor="template-name"><input id="template-name" className={INPUT_CLASS} value={name} onChange={e => setName(e.target.value)} required maxLength={120} /></Field>
        <Field label="Descrição" htmlFor="template-description"><textarea id="template-description" className={INPUT_CLASS} value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} /></Field>
        {library.data?.canPublish && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={official} onChange={e => setOfficial(e.target.checked)} /> Modelo oficial (rascunho global)</label>}
        <button className={BTN_PRIMARY} type="submit" disabled={busy || !name.trim()}>{busy ? 'Salvando…' : 'Salvar modelo'}</button>
      </form>
    </Modal>
  </>;
}
