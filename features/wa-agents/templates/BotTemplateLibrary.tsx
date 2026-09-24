'use client';
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import { MAX_BOT_TEMPLATE_BYTES, type BotTemplate } from '@/lib/wa-agents/botTemplates';
import type { BotRow } from '@/lib/wa-agents/types';
import type { DependencyKind } from '@/lib/wa-agents/botTemplateDependencies';
import { useWaAgentOptions, useWaAgentsList, useWaBotsList, waAgentsFetch, WA_AGENTS_QUERY_KEY } from '../useWaAgents';
import { useMessageTemplates } from '../canvas/templatePreview';
import { BTN_PRIMARY, BTN_SECONDARY, INPUT_CLASS, Field, Notice, Spinner, errorMessage } from '../ui';
import { BOT_TEMPLATES_KEY, useBotTemplates } from './useBotTemplates';

export function BotTemplateLibrary({ onClose, onCreated, onBlank }: { onClose: () => void; onCreated: (bot: BotRow) => void; onBlank: () => void }) {
  const library = useBotTemplates(); const options = useWaAgentOptions(); const agents = useWaAgentsList(); const bots = useWaBotsList(); const messages = useMessageTemplates();
  const qc = useQueryClient(); const { showToast } = useToast();
  const [selected, setSelected] = useState<{ snapshot: BotTemplate; id?: string } | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({}); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const select = (snapshot: BotTemplate, id?: string) => { setSelected({ snapshot, id }); setBindings({}); setName(snapshot.bot.name); setError(''); };
  function choices(kind: DependencyKind): Array<{ value: string; label: string }> {
    const o = options.data;
    switch (kind) {
      case 'connection': return (o?.connections ?? []).map(x => ({ value: x.id, label: x.label }));
      case 'board': return (o?.boards ?? []).map(x => ({ value: x.id, label: x.name }));
      case 'stage': return (o?.boards ?? []).flatMap(b => b.stages.map(x => ({ value: x.id, label: `${b.name} / ${x.label}` })));
      case 'owner': return (o?.owners ?? []).map(x => ({ value: x.id, label: x.name }));
      case 'custom_field': return (o?.custom_fields ?? []).map(x => ({ value: x.key, label: x.label }));
      case 'agent': return (agents.data ?? []).map(x => ({ value: x.id, label: x.name }));
      case 'bot': return (bots.data ?? []).map(x => ({ value: x.id, label: x.name }));
      case 'message_template': return (messages.data?.data ?? []).map(x => ({ value: x.id, label: x.name }));
      default: return [];
    }
  }
  async function upload(file?: File) {
    if (!file) return; setError(''); setBusy(true);
    try {
      if (file.size > MAX_BOT_TEMPLATE_BYTES) throw new Error('O arquivo excede 1 MB');
      const snapshot = JSON.parse(await file.text());
      const result = await waAgentsFetch<{ snapshot: BotTemplate }>('/api/wa-agents/bot-templates', { method: 'POST', body: { action: 'preview', snapshot } });
      select(result.snapshot);
    } catch (err) { setError(errorMessage(err, 'JSON inválido')); } finally { setBusy(false); }
  }
  async function createCopy() {
    if (!selected) return; setBusy(true); setError('');
    try {
      const { bot, pending } = await waAgentsFetch<{ bot: BotRow; pending: string[] }>('/api/wa-agents/bot-templates', { method: 'POST', body: { action: 'import', ...(selected.id ? { templateId: selected.id } : { snapshot: selected.snapshot }), bindings, name } });
      qc.setQueryData<BotRow[]>([WA_AGENTS_QUERY_KEY, 'bots'], current => [...(current ?? []), bot]);
      showToast(pending.length ? `Cópia criada desligada. Pendências: ${pending.join('; ')}` : 'Cópia criada desligada. Revise os vínculos e webhooks antes de ligar.', pending.length ? 'info' : 'success'); onCreated(bot);
    } catch (err) { setError(errorMessage(err, 'Falha ao criar cópia')); } finally { setBusy(false); }
  }
  async function publish(id: string, published: boolean) {
    setBusy(true); setError('');
    try { await waAgentsFetch(`/api/wa-agents/bot-templates/${id}`, { method: 'PATCH', body: { published } }); await qc.invalidateQueries({ queryKey: BOT_TEMPLATES_KEY }); }
    catch (err) { setError(errorMessage(err, 'Falha ao publicar')); } finally { setBusy(false); }
  }
  const missingNumbers = selected?.snapshot.dependencies.some(d => d.kind === 'connection' && !bindings[d.ref]);
  return <Modal isOpen onClose={onClose} title={selected ? 'Reassociar recursos do modelo' : 'Novo robô'} size="lg">
    <div className="space-y-4">
      {error && <Notice tone="red">{error}</Notice>}
      {selected ? <>
        <p className="text-sm text-slate-500">Escolha os recursos desta organização. A cópia será criada desligada. Números são obrigatórios; os demais campos podem ser concluídos no editor antes da ativação.</p>
        <Field label="Nome do robô" htmlFor="copy-name"><input id="copy-name" className={INPUT_CLASS} value={name} onChange={e => setName(e.target.value)} maxLength={120} /></Field>
        {selected.snapshot.dependencies.map(d => <Field key={d.ref} label={d.label} htmlFor={`binding-${d.ref}`}>
          {d.kind === 'webhook' ? <input id={`binding-${d.ref}`} className={INPUT_CLASS} type="url" placeholder="Configurar URL pública aqui ou no editor" value={bindings[d.ref] ?? ''} onChange={e => setBindings({ ...bindings, [d.ref]: e.target.value })} /> :
            <select id={`binding-${d.ref}`} className={INPUT_CLASS} value={bindings[d.ref] ?? ''} onChange={e => setBindings({ ...bindings, [d.ref]: e.target.value })}>
              <option value="">{d.kind === 'connection' ? 'Selecione um número' : 'Pendente — configurar no editor'}</option>
              {choices(d.kind).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>}
        </Field>)}
        <Notice>Webhooks precisam de nova configuração de segredo e corpo. Cada cópia é independente do modelo.</Notice>
        <div className="flex gap-2"><button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setSelected(null)}>Voltar</button><button type="button" className={BTN_PRIMARY} disabled={busy || !name.trim() || missingNumbers} onClick={() => void createCopy()}>{busy ? 'Criando…' : 'Criar cópia desligada'}</button></div>
      </> : <>
        <div className="flex flex-wrap items-center gap-3">
          <button className={BTN_PRIMARY} type="button" onClick={onBlank}>Criar do zero</button>
          <label className={`${BTN_SECONDARY} cursor-pointer`}>Importar JSON<input aria-label="Importar modelo JSON" className="sr-only" type="file" accept=".json,application/json" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
        <p className="text-sm text-slate-500">Use um modelo oficial ou um modelo privado da sua organização.</p>
        {library.isLoading ? <Spinner label="Carregando modelos…" /> : library.error ? <Notice tone="red">{errorMessage(library.error, 'Falha ao carregar biblioteca')}</Notice> : <>
          {(['official', 'private'] as const).map(section => <section key={section} className="space-y-2"><h3 className="font-semibold">{section === 'official' ? 'Modelos oficiais' : 'Modelos da organização'}</h3>
            {(library.data?.templates ?? []).filter(t => t.official === (section === 'official')).map(t => <div key={t.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <p className="font-medium">{t.name}{t.official && !t.published ? ' · Rascunho' : ''}</p><p className="text-sm text-slate-500">{t.description || `${t.snapshot.bot.steps.length} passos`}</p>
              <div className="flex gap-2"><button className={BTN_SECONDARY} type="button" onClick={() => select(t.snapshot, t.id)}>Usar modelo</button>{library.data?.canPublish && t.official && <button className={BTN_SECONDARY} type="button" disabled={busy} onClick={() => void publish(t.id, !t.published)}>{t.published ? 'Despublicar' : 'Publicar'}</button>}</div>
            </div>)}
            {!(library.data?.templates ?? []).some(t => t.official === (section === 'official')) && <p className="text-sm text-slate-500">Nenhum modelo disponível.</p>}
          </section>)}
        </>}
      </>}
    </div>
  </Modal>;
}
