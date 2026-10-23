'use client';
import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Gauge, LockKeyhole, X } from 'lucide-react';
import { SETTINGS_BTN_PRIMARY, SETTINGS_BTN_SECONDARY, SETTINGS_INPUT_CLASS } from '@/features/settings/components/SettingsUi';
import { useConversationUsage, useGrantUsage } from './useAiUsage';
const integer = (n: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(n);
function pauseReason(reason: string | null): string {
  const labels: Record<string, string> = {
    conversation_token_limit: 'A próxima operação não cabe no saldo de tokens desta conversa.',
    conversation_audio_limit: 'A próxima transcrição não cabe na quota de áudio desta conversa.',
    audio_limit_not_configured: 'A quota de transcrição de áudio ainda não foi configurada.',
    organization_daily_token_limit: 'O limite de tokens da organização nas últimas 24 horas foi atingido.',
    AI_USAGE_UNKNOWN: 'O consumo de uma operação está aguardando confirmação.',
    unsupported_usage_bound: 'Este modelo ou operação não permite reservar um limite seguro de consumo.',
    usage_bound_exceeded: 'O consumo informado pelo provedor excedeu a reserva prevista.',
  };
  return labels[reason ?? ''] ?? 'Não foi possível autorizar uma nova operação dentro das regras de consumo.';
}

export function ConversationBudget({ conversationId }: { conversationId: string }) {
  return <ConversationBudgetContent key={conversationId} conversationId={conversationId} />;
}
function ConversationBudgetContent({ conversationId }: { conversationId: string }) {
  const query = useConversationUsage(conversationId); const grant = useGrantUsage(conversationId);
  const [open, setOpen] = useState(false); const [tokens, setTokens] = useState(''); const [seconds, setSeconds] = useState(''); const [reason, setReason] = useState('');
  const [operation, setOperation] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  if (query.isPending) return null;
  if (query.error) return <p role="status" className="px-3 py-1 text-xs text-amber-700">Consumo da IA indisponível. O atendimento humano continua disponível.</p>;
  if (!query.data) return null;
  const { budget, canGrant, grants } = query.data;
  if (!budget.account_id && !budget.policy.enabled) return null;
  const tokenQuota = (budget.policy.conversation_tokens ?? 0) + budget.tokens_granted;
  const available = Math.max(0, tokenQuota - budget.tokens_used - budget.tokens_reserved);
  const blocked = !!budget.blocked_at;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Retrying a failed HTTP request reuses the operation ID, preventing double grants.
    const idempotencyKey = operation ?? crypto.randomUUID(); setOperation(idempotencyKey);
    try { await grant.mutateAsync({ tokens: Number(tokens || 0), seconds: Number(seconds || 0), reason, idempotencyKey }); setOpen(false); setOperation(null); setReason(''); setTokens(''); setSeconds(''); setSuccess(true); } catch { /* shown below */ }
  };
  return <div className={`rounded-lg border px-3 py-2 text-xs ${blocked ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300'}`}>
    <div className="flex items-center gap-2 flex-wrap">{blocked ? <LockKeyhole size={14} /> : <Gauge size={14} />}<strong>{blocked ? 'IA pausada pelo controle de consumo' : 'Consumo da IA'}</strong><span>{integer(budget.tokens_used)} tokens usados{budget.policy.enabled ? ` · ${integer(available)} disponíveis` : ''}</span><button className="ml-auto font-semibold text-primary-600 hover:underline" type="button" onClick={() => setOpen(true)}>Ver consumo{canGrant && blocked ? ' e liberar' : ''}</button></div>
    {blocked && <p className="mt-1">A retomada depende de liberação manual. Você pode continuar o atendimento humano.</p>}
    {success && <p role="status" className="mt-1 text-emerald-700">Saldo liberado. Retome a IA pelo botão Retomar quando quiser continuar o atendimento automático.</p>}
    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/50" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[101] max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
      <div className="flex justify-between gap-3"><Dialog.Title className="text-lg font-bold text-slate-900 dark:text-white">Consumo deste atendimento</Dialog.Title><Dialog.Close aria-label="Fechar" className="text-slate-500"><X size={20} /></Dialog.Close></div>
      <Dialog.Description className="mt-2 text-sm text-slate-500">Consumo acumulado, independente do período do painel. Liberar quota mantém todo o histórico.</Dialog.Description>
      {blocked && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{pauseReason(budget.blocked_reason)}</p>}
      <dl className="my-5 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Tokens confirmados</dt><dd className="font-semibold">{integer(budget.tokens_used)}</dd></div><div><dt className="text-slate-500">Tokens reservados</dt><dd className="font-semibold">{integer(budget.tokens_reserved)}</dd></div><div><dt className="text-slate-500">Quota adicional liberada</dt><dd className="font-semibold">{integer(budget.tokens_granted)}</dd></div><div><dt className="text-slate-500">Áudio usado / reservado</dt><dd className="font-semibold">{integer(budget.seconds_used)}s / {integer(budget.seconds_reserved)}s</dd></div></dl>
      {budget.policy.enabled && <p className="mb-4 text-sm"><strong>{integer(available)} tokens disponíveis</strong> da quota total de {integer(tokenQuota)} desta conversa.</p>}
      {budget.tokens_reserved > 0 && <p className="mb-4 text-xs text-amber-700">Reservas incluem operações em andamento ou aguardando confirmação. Elas continuam ocupando saldo.</p>}
      {canGrant ? <form onSubmit={submit} className="space-y-3 border-t border-slate-100 pt-4 dark:border-white/10">
        <h3 className="text-sm font-semibold">Liberar quota adicional</h3>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs">Tokens<input type="number" min="0" max="100000000" step="1" value={tokens} onChange={e => { setTokens(e.target.value); setOperation(null); }} className={`${SETTINGS_INPUT_CLASS} mt-1`} placeholder="Quantidade" /></label><label className="text-xs">Áudio (segundos)<input type="number" min="0" max="86400" step="1" value={seconds} onChange={e => { setSeconds(e.target.value); setOperation(null); }} className={`${SETTINGS_INPUT_CLASS} mt-1`} placeholder="Opcional" /></label></div>
        <label className="block text-xs">Motivo<textarea required minLength={5} maxLength={500} value={reason} onChange={e => { setReason(e.target.value); setOperation(null); }} className={`${SETTINGS_INPUT_CLASS} mt-1`} rows={2} placeholder="Por que este atendimento precisa de mais quota?" /></label>
        <p className="text-xs text-slate-500">A liberação fica registrada em seu nome. Este botão não envia mensagem ao contato.</p>
        {grant.error && <p role="alert" className="text-sm text-red-600">{grant.error.message}</p>}
        <div className="flex justify-end gap-2"><Dialog.Close className={SETTINGS_BTN_SECONDARY}>Cancelar</Dialog.Close><button type="submit" disabled={grant.isPending || !(Number(tokens) > 0 || Number(seconds) > 0)} className={SETTINGS_BTN_PRIMARY}>{grant.isPending ? 'Liberando…' : 'Confirmar liberação'}</button></div>
      </form> : <p className="text-sm text-slate-500">Somente o responsável por este atendimento ou um administrador pode liberar quota.</p>}
      {grants.length > 0 && <details className="mt-5 text-xs"><summary className="cursor-pointer font-semibold">Últimas {grants.length} liberações</summary><ul className="mt-3 space-y-3">{grants.map(g => <li key={g.id} className="border-t border-slate-100 pt-2"><strong>+{integer(g.tokens)} tokens{g.seconds > 0 ? ` · +${integer(g.seconds)}s` : ''}</strong><p className="text-slate-500">{new Date(g.created_at).toLocaleString('pt-BR')} · {g.reason}</p></li>)}</ul></details>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
