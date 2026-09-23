'use client';
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import type { BulkRecipient, BulkRunResult } from '@/lib/wa-agents/bulkBots';

type Bot = { id: string; name: string; enabled: boolean };
type Run = { id: string; deal_id: string; status: string; error: string | null };
type Prepared = { botName: string; recipients: BulkRecipient[] };
const inputClass = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm';
const buttonClass = 'rounded-lg bg-primary-600 hover:bg-primary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed';
const statusLabel: Record<string, string> = { running: 'Na fila / executando', waiting_reply: 'Aguardando resposta', done: 'Concluído', error: 'Falhou', cancelled: 'Cancelado' };

/** Mounted only while open; selection and request id stay fixed throughout the confirmation. */
export function BulkBotModal({ dealIds: initialIds, onClose }: { dealIds: string[]; onClose: () => void }) {
  const { organizationId } = useAuth();
  const [dealIds] = useState(() => [...initialIds]);
  const [batchId] = useState(() => crypto.randomUUID());
  const [botId, setBotId] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [results, setResults] = useState<BulkRunResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bots = useQuery({
    queryKey: ['bulk-bots', organizationId],
    queryFn: async (): Promise<Bot[]> => {
      const res = await fetch('/api/wa-agents/bots');
      if (!res.ok) throw new Error('Não foi possível carregar os robôs.');
      return ((await res.json()).bots as Bot[]).filter(b => b.enabled);
    },
  });
  const runs = useQuery({
    queryKey: ['bulk-bot-runs', organizationId, botId, batchId],
    enabled: results !== null,
    queryFn: async (): Promise<Run[]> => {
      const res = await fetch(`/api/wa-agents/bots/${botId}/bulk-start?batchId=${batchId}`);
      if (!res.ok) throw new Error('Não foi possível atualizar o andamento.');
      return (await res.json()).runs;
    },
    refetchInterval: query => query.state.data?.every(r => !['running', 'waiting_reply'].includes(r.status)) ? false : 5000,
  });
  async function submit(preview: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/wa-agents/bots/${botId}/bulk-start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealIds, batchId, preview }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível preparar o lote.');
      setPrepared(data);
      if (!preview) setResults(data.results);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao iniciar o lote. Tente novamente.'); }
    finally { setBusy(false); }
  }
  const eligible = prepared?.recipients.filter(r => r.eligible).length ?? 0;
  const queued = results?.filter(r => r.status !== 'skipped').length ?? 0;
  const ignored = prepared ? prepared.recipients.length - (results ? queued : eligible) : 0;
  return (
    <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Executar robô" size="xl"
      footer={<div className="flex justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="px-3 py-2 text-sm">{results ? 'Fechar' : 'Cancelar'}</button>
        {!results && <button type="button" className={buttonClass} disabled={busy || !botId || dealIds.length > 500 || (prepared !== null && !eligible)} onClick={() => void submit(!prepared)}>
          {busy ? 'Processando…' : prepared ? `Confirmar execução (${eligible})` : 'Revisar destinatários'}
        </button>}
      </div>}>
      <div className="space-y-4 text-slate-700 dark:text-slate-200">
        <p className="text-sm">{dealIds.length} leads selecionados. O robô usará o número e as etapas já configurados.</p>
        {dealIds.length > 500 && <p role="alert" className="text-sm text-red-600">Selecione até 500 leads por lote.</p>}
        <label className="block text-sm font-medium">Robô
          <select aria-label="Robô" className={`${inputClass} mt-1`} value={botId} disabled={busy || results !== null}
            onChange={e => { setBotId(e.target.value); setPrepared(null); setError(''); }}>
            <option value="">{bots.isLoading ? 'Carregando…' : 'Selecione um robô ativo'}</option>
            {bots.data?.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
          </select>
        </label>
        {bots.isError && <p role="alert" className="text-sm text-red-600">Não foi possível carregar os robôs. <button type="button" onClick={() => void bots.refetch()}>Tentar novamente</button></p>}
        {bots.isSuccess && !bots.data.length && <p className="text-sm">Ative um robô em Configurações → Robôs para continuar.</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {prepared && <>
          <p role="status" className="rounded-lg bg-primary-50 dark:bg-primary-950/40 p-3 text-sm">
            {results ? `${queued} execuções na fila; ${ignored} leads ignorados. Você pode fechar esta janela; o lote continuará em segundo plano.` : `${eligible} destinatários válidos; ${ignored} ignorados. Telefones repetidos recebem uma única execução. Contatos com robô em andamento serão ignorados ao confirmar.`}
          </p>
          {runs.isError && <p role="alert" className="text-sm text-red-600">O lote foi registrado, mas não foi possível atualizar o andamento. <button type="button" onClick={() => void runs.refetch()}>Atualizar</button></p>}
          <ul className="max-h-72 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700">
            {prepared.recipients.map(r => {
              const result = results?.find(x => x.dealId === r.dealId);
              const run = runs.data?.find(x => x.id === result?.runId);
              const label = !r.eligible ? r.reason : result?.status === 'skipped' ? result.reason : run ? (run.error || statusLabel[run.status] || run.status) : results ? 'Na fila' : 'Pronto para iniciar';
              return <li key={r.dealId} className="py-2 text-sm"><p className="font-medium break-words">{r.title}</p><p className="text-xs text-slate-500">{r.phone && `${r.phone} · `}{label}</p></li>;
            })}
          </ul>
        </>}
      </div>
    </Modal>
  );
}
