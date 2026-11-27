'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, KeyRound } from 'lucide-react';

type KeyScope = 'ai_agents_read' | 'feedback';
type KeyInfo = {
  id: string; name: string; key_prefix: string; scope?: KeyScope; last_used_at: string | null; revoked_at: string | null;
};
const endpoint = '/api/superadmin/operator-keys';
const actionClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/20';

async function requestKeys<T>(init: RequestInit): Promise<T> {
  const result = await fetch(endpoint, { cache: 'no-store', ...init });
  const body = await result.json();
  if (!result.ok) throw new Error(body.error || 'Não foi possível acessar as chaves.');
  return body;
}

function OperatorKeysForm() {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<KeyScope>('ai_agents_read');
  const [secret, setSecret] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    requestKeys<{ data: KeyInfo[] }>({ signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setKeys(data); })
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível carregar as chaves. Feche e reabra esta seção para tentar de novo.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || secret || !name.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await requestKeys<{ data: KeyInfo; token: string }>({
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), scope }),
      });
      setKeys(previous => [result.data, ...previous]);
      setSecret(result.token); setCopied(false); setName('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível criar a chave.'); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await requestKeys<{ data: KeyInfo }>({
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      setKeys(previous => previous.map(key => key.id === id ? result.data : key));
      setConfirmId(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível revogar a chave.'); }
    finally { setBusy(false); }
  }

  return <div className="mt-4 space-y-4">
    <p className="text-sm text-slate-600 dark:text-slate-300">Use uma chave no conector do Paperclip para consultar os agentes dos escritórios. O conteúdo só fica disponível para agentes com “Monitorar com o squad” ligado. A chave da esteira de ajustes só lê os pedidos e atualiza o status deles.</p>
    {secret ? <div className="space-y-2 rounded-lg border p-3">
      <label htmlFor="operator-token" className="block text-sm font-semibold">Copie a chave agora. Ela só aparece uma vez.</label>
      <input id="operator-token" className="w-full rounded border p-2 font-mono text-sm dark:bg-dark-card" readOnly value={secret} onFocus={e => e.target.select()} />
      <button className={actionClass} onClick={async () => {
        try { await navigator.clipboard.writeText(secret); setCopied(true); }
        catch { setError('Selecione a chave e copie manualmente.'); }
      }}>{copied ? 'Copiada' : 'Copiar chave'}</button>{' '}
      <button className={actionClass} onClick={() => { setSecret(''); setError(''); }}>Concluir</button>
    </div> : <form className="flex flex-wrap items-end gap-2" onSubmit={create}>
      <label className="text-sm">Nome da chave
        <input required maxLength={120} className="mt-1 block rounded border px-3 py-2 dark:bg-dark-card" value={name} onChange={e => setName(e.target.value)} />
      </label>
      <select aria-label="Tipo de chave" className="rounded border px-3 py-2 text-sm dark:bg-dark-card" value={scope} onChange={e => setScope(e.target.value as KeyScope)}>
        <option value="ai_agents_read">Leitura de agentes (Monitor)</option>
        <option value="feedback">Esteira de ajustes</option>
      </select>
      <button className={actionClass} disabled={busy || !name.trim()}>{scope === 'feedback' ? 'Criar chave da esteira' : 'Criar chave de leitura'}</button>
    </form>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {!busy && !keys.length && !error && <p className="text-sm text-slate-500">Nenhuma chave criada.</p>}
    <ul className="divide-y divide-slate-200 dark:divide-white/10">{keys.map(key => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><strong>{key.name}</strong> <span className="text-xs text-slate-500">{key.scope === 'feedback' ? 'Esteira' : 'Monitor'}</span> <code className="text-xs">{key.key_prefix}…</code>
        <p className="text-xs text-slate-500">Último uso: {key.last_used_at ? new Date(key.last_used_at).toLocaleString('pt-BR') : 'nunca usada'}</p>
      </div>
      {key.revoked_at ? <span className="text-sm">Revogada</span> : confirmId === key.id ? <div>
        <span className="mr-2 text-sm">Interromper o acesso desta chave?</span>
        <button className={actionClass} disabled={busy} onClick={() => void revoke(key.id)}>Confirmar revogação</button>{' '}
        <button className={actionClass} disabled={busy} onClick={() => setConfirmId(null)}>Cancelar</button>
      </div> : <button className={actionClass} disabled={busy || !!secret} onClick={() => setConfirmId(key.id)}>Revogar</button>}
    </li>)}</ul>
  </div>;
}

export function OperatorKeysPanel() {
  const [open, setOpen] = useState(false);
  return <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-dark-card">
    <h2><button className="flex w-full items-center gap-2 text-left font-bold" aria-expanded={open} onClick={() => setOpen(!open)}>
      <KeyRound size={18} /> Chaves de operador da AJ <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
    </button></h2>
    {open && <OperatorKeysForm />}
  </section>;
}
