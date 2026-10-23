'use client';
import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { SettingsCard, SETTINGS_INPUT_CLASS, SETTINGS_BTN_PRIMARY } from '@/features/settings/components/SettingsUi';
import { Field, Toggle } from '@/features/wa-agents/ui';
import type { UsagePolicy } from '@/lib/ai-usage/types';
import { useSaveUsagePolicy, type PolicyInput } from './useAiUsage';

export function BudgetSettings({ policy, canEdit }: { policy: UsagePolicy; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [tokens, setTokens] = useState(String(policy.conversation_tokens ?? ''));
  const [daily, setDaily] = useState(String(policy.organization_daily_tokens ?? ''));
  const [seconds, setSeconds] = useState(String(policy.conversation_audio_seconds ?? ''));
  const [timezone, setTimezone] = useState(policy.timezone);
  const [saved, setSaved] = useState(false); const mutation = useSaveUsagePolicy();
  const number = (value: string) => value.trim() ? Number(value) : null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaved(false);
    const input: PolicyInput = { enabled, conversation_tokens: number(tokens), organization_daily_tokens: number(daily), conversation_audio_seconds: number(seconds), timezone };
    try { await mutation.mutateAsync(input); setSaved(true); } catch { /* mutation renders the error */ }
  };
  return <SettingsCard title="Regras de consumo" description="A liberação de saldo é manual. Alterar a regra não apaga o consumo já registrado." icon={ShieldCheck}>
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">Limitar o atendimento automático</p><p className="text-xs text-slate-500">Escolha as quotas antes de ativar. Atendimentos bloqueados exigem liberação do responsável.</p></div><Toggle label="Limitar o atendimento automático" checked={enabled} onChange={setEnabled} disabled={!canEdit || mutation.isPending} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tokens por conversa" htmlFor="quota-conversation" help="Entrada + saída, incluindo auxiliares. Não reinicia ao trocar de agente ou número."><input id="quota-conversation" type="number" min="1" max="100000000" step="1" required={enabled} value={tokens} onChange={e => setTokens(e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} placeholder="Defina uma quota" /></Field>
        <Field label="Tokens em 24h na organização" htmlFor="quota-daily" help="Janela móvel de 24 horas, incluindo simulador e configuração. Reservas pendentes não vencem por tempo."><input id="quota-daily" type="number" min="1" max="1000000000" step="1" required={enabled} value={daily} onChange={e => setDaily(e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} placeholder="Defina o limite de 24 horas" /></Field>
        <Field label="Áudio por conversa (segundos)" htmlFor="quota-audio" help="Transcrição usa uma unidade própria. Sem quota, áudio pago fica indisponível no modo protegido."><input id="quota-audio" type="number" min="1" max="86400" step="1" value={seconds} onChange={e => setSeconds(e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} placeholder="Opcional" /></Field>
        <Field label="Fuso do painel" htmlFor="quota-timezone"><select id="quota-timezone" value={timezone} onChange={e => setTimezone(e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS}>{[...new Set([timezone, 'America/Manaus', 'America/Sao_Paulo', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'UTC'])].map(tz => <option key={tz}>{tz}</option>)}</select></Field>
      </div>
      {mutation.error && <p role="alert" className="text-sm text-red-600">{mutation.error.message}</p>}
      {saved && <p role="status" className="text-sm text-emerald-700">Regras salvas.</p>}
      {canEdit && <button type="submit" disabled={mutation.isPending} className={SETTINGS_BTN_PRIMARY}>{mutation.isPending ? 'Salvando…' : 'Salvar regras'}</button>}
    </form>
  </SettingsCard>;
}
