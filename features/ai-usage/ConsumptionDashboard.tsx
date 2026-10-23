'use client';
import React, { useState } from 'react';
import { BarChart3, Coins, Gauge, LockKeyhole, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SettingsCard, SETTINGS_INPUT_CLASS, SETTINGS_BTN_SECONDARY } from '@/features/settings/components/SettingsUi';
import { localDay, USAGE_OPERATION_LABELS, USAGE_SCOPE_LABELS, type UsageFilters } from '@/lib/ai-usage/reporting';
import { useUsagePolicy, useUsageSummary } from './useAiUsage';
import { BudgetSettings } from './BudgetSettings';
import { ConversationBudget } from './ConversationBudget';

const fmt = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
const money = (value: number | null) => value === null ? 'Indisponível' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
const operationLabel = (value: string) => USAGE_OPERATION_LABELS[value] ?? value;
function Metric({ title, value, detail, icon: Icon }: { title: string; value: string; detail: string; icon: typeof Gauge }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5"><div className="flex items-center gap-2 text-xs text-slate-500"><Icon className="h-4 w-4 text-primary-500" />{title}</div><p className="mt-3 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

export function ConsumptionDashboard() {
  const policy = useUsagePolicy();
  const [from, setFrom] = useState(() => `${localDay(new Date().toISOString(), 'America/Manaus').slice(0, 7)}-01`);
  const [to, setTo] = useState(() => localDay(new Date().toISOString(), 'America/Manaus'));
  const [provider, setProvider] = useState(''); const [model, setModel] = useState(''); const [operation, setOperation] = useState('');
  const [scope, setScope] = useState<UsageFilters['scope']>(); const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const summary = useUsageSummary({ from, to, provider, model, operation, scope }); const data = summary.data;
  const input = `${SETTINGS_INPUT_CLASS} min-w-0`;
  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-4 flex-wrap"><div><h2 className="text-xl font-bold text-slate-900 dark:text-white">Consumo e limites</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">Atendimento automático do WhatsApp, auxiliares, simulador e configuração. Chamadas externas e outros recursos de IA do CRM ficam fora desta medição.</p></div><button onClick={() => { void summary.refetch(); void policy.refetch(); }} disabled={summary.isFetching} className={SETTINGS_BTN_SECONDARY}><RefreshCw size={15} className={summary.isFetching ? 'animate-spin' : ''} />Atualizar</button></div>
    <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <label className="text-xs text-slate-600">De<input aria-label="Início do período" type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${input} mt-1`} /></label>
      <label className="text-xs text-slate-600">Até<input aria-label="Fim do período" type="date" value={to} onChange={e => setTo(e.target.value)} className={`${input} mt-1`} /></label>
      <label className="text-xs text-slate-600">Provedor<select value={provider} onChange={e => setProvider(e.target.value)} className={`${input} mt-1`}><option value="">Todos</option>{data?.options.providers.map(p => <option key={p}>{p}</option>)}</select></label>
      <label className="text-xs text-slate-600">Modelo<select value={model} onChange={e => setModel(e.target.value)} className={`${input} mt-1`}><option value="">Todos</option>{data?.options.models.map(p => <option key={p}>{p}</option>)}</select></label>
      <label className="text-xs text-slate-600">Finalidade<select value={operation} onChange={e => setOperation(e.target.value)} className={`${input} mt-1`}><option value="">Todas</option>{data?.options.operations.map(p => <option key={p} value={p}>{operationLabel(p)}</option>)}</select></label>
      <label className="text-xs text-slate-600">Uso<select value={scope ?? ''} onChange={e => setScope((e.target.value || undefined) as UsageFilters['scope'])} className={`${input} mt-1`}><option value="">Todos</option>{Object.entries(USAGE_SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <p className="text-xs text-slate-500">Período da operação · Fuso: {policy.data?.policy.timezone ?? 'America/Manaus'}. O saldo acumulado do atendimento não muda com esses filtros.</p>
    {summary.isPending && <p role="status" className="py-10 text-center text-slate-500">Carregando consumo…</p>}
    {summary.error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{summary.error.message}</p>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric title="Tokens confirmados" value={fmt(data.tokens)} detail={`${fmt(data.inputTokens)} entrada · ${fmt(data.outputTokens)} saída`} icon={Gauge} />
        <Metric title="Custo estimado coberto" value={money(data.estimatedCostUsd)} detail={data.unpricedOperations ? `${fmt(data.unpricedOperations)} operações sem tarifa. Total parcial.` : 'Em USD · estimativa, não uma fatura'} icon={Coins} />
        <Metric title="Média por atendimento" value={data.averageTokens === null ? '—' : `${fmt(data.averageTokens)} tokens`} detail={`${fmt(data.conversationTokens)} tokens ÷ ${fmt(data.conversationCount)} atendimentos no período`} icon={BarChart3} />
        <Metric title="Atendimentos bloqueados" value={fmt(data.blockedConversations)} detail="Situação atual de toda a organização" icon={LockKeyhole} />
        <Metric title="Aguardando confirmação" value={fmt(data.pendingOperations)} detail={`${fmt(data.pendingTokens)} tokens reservados no período`} icon={Gauge} />
      </div>
      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        <SettingsCard title="Consumo diário" description="Tokens confirmados, pela data de cada operação." icon={BarChart3}>
          {data.days.length ? <><div className="h-56" role="img" aria-label="Gráfico do consumo diário de tokens"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.days} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="date" tickFormatter={v => `${String(v).slice(8)}/${String(v).slice(5, 7)}`} fontSize={11} tickLine={false} axisLine={false} /><YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => fmt(Number(v))} /><Tooltip formatter={v => [fmt(Number(v)), 'Tokens']} labelFormatter={v => `Dia ${v}`} /><Bar isAnimationActive={false} dataKey="tokens" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={30} /></BarChart></ResponsiveContainer></div><details className="mt-3 text-xs"><summary className="cursor-pointer text-primary-600">Ver valores diários</summary><ul className="mt-2 grid grid-cols-2 gap-2">{data.days.map(d => <li key={d.date}>{d.date}: {fmt(d.tokens)}</li>)}</ul></details></> : <p className="py-20 text-center text-sm text-slate-500">Nenhuma operação confirmada neste período.</p>}
          <p className="mt-4 text-xs text-slate-500">{fmt(data.otherTokens)} tokens de teste/configuração e outros usos, separados da média por atendimento. {fmt(data.audioSeconds)} segundos de áudio confirmados.</p>
        </SettingsCard>
        <SettingsCard title="Atendimentos com maior consumo" description="Consumo no período selecionado. Abra para conferir o saldo acumulado.">
          {data.conversations.length ? <ol className="divide-y divide-slate-100 dark:divide-white/10">{(showAll ? data.conversations : data.conversations.slice(0, 8)).map((c, index) => <li key={c.accountId} className="flex items-center gap-3 py-3"><span className="text-xs text-slate-400">{index + 1}</span><button type="button" disabled={!c.conversationId} onClick={() => setSelected(c.conversationId)} className="min-w-0 flex-1 text-left text-sm font-medium text-primary-600 hover:underline disabled:text-slate-500"><span className="block truncate">{c.name}</span><span className="block text-xs font-normal text-slate-500">{c.pending ? `${c.pending} ${c.pending === 1 ? 'operação pendente' : 'operações pendentes'}` : `${money(c.costUsd)}${c.unpriced && c.costUsd !== null ? ' · parcial' : ''}`}</span></button><span className="shrink-0 text-sm font-semibold tabular-nums">{fmt(c.tokens)} <span className="text-xs font-normal text-slate-500">tokens</span></span></li>)}</ol> : <p className="py-20 text-center text-sm text-slate-500">Nenhum atendimento medido neste período.</p>}
          {data.conversations.length > 8 && <button type="button" className="mt-3 text-xs font-semibold text-primary-600" onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar menos' : `Ver os ${data.conversations.length} atendimentos`}</button>}
        </SettingsCard>
      </div>
      {selected && <div className="space-y-2"><div className="flex justify-between text-sm"><strong>Detalhes do atendimento</strong><button type="button" className="text-primary-600" onClick={() => setSelected(null)}>Fechar detalhes</button></div><ConversationBudget key={selected} conversationId={selected} /></div>}
      <SettingsCard title="Por modelo e finalidade" description="A mesma base usada no total acima, sem somar apenas as últimas execuções."><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-3">Provedor / modelo</th><th className="pb-3">Finalidade</th><th className="pb-3 text-right">Operações</th><th className="pb-3 text-right">Tokens</th></tr></thead><tbody>{data.breakdown.map(r => <tr key={`${r.provider}/${r.model}/${r.operation}`} className="border-t border-slate-100 dark:border-white/10"><td className="py-3">{r.provider} · {r.model}</td><td>{operationLabel(r.operation)}</td><td className="text-right">{fmt(r.calls)}</td><td className="text-right tabular-nums">{fmt(r.tokens)}</td></tr>)}</tbody></table>{!data.breakdown.length && <p className="py-5 text-sm text-slate-500">Sem operações confirmadas.</p>}</div></SettingsCard>
      <SettingsCard title="Consumo até o contrato" description="Negócios cujo primeiro ganho ocorreu no período. Todas as operações cobertas até esse ganho; reabertura não duplica o negócio.">
        <div className="grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-slate-500">Média de tokens</p><p className="mt-1 text-xl font-bold">{data.coverage.contracts.averageTokens === null ? 'Indisponível' : fmt(data.coverage.contracts.averageTokens)}</p><p className="text-xs text-slate-500">{data.coverage.contracts.coveredDeals} negócios com cobertura completa</p></div><div><p className="text-xs text-slate-500">Custo médio estimado</p><p className="mt-1 text-xl font-bold">{money(data.coverage.contracts.averageCostUsd)}</p><p className="text-xs text-slate-500">{data.coverage.contracts.pricedDeals} negócios com todas as tarifas disponíveis</p></div><div><p className="text-xs text-slate-500">Fora da média</p><p className="mt-1 text-xl font-bold">{data.coverage.contracts.excludedDeals}</p><p className="text-xs text-slate-500">Cobertura parcial, vínculo ambíguo ou uso pendente</p></div></div>
      </SettingsCard>
      <p className="text-xs leading-relaxed text-slate-500">Medição detalhada {data.coverage.firstMeasuredAt ? `desde ${new Date(data.coverage.firstMeasuredAt).toLocaleDateString('pt-BR', { timeZone: data.period.timezone })}` : 'disponível a partir das primeiras operações registradas'}. Registros antigos têm cobertura parcial. {data.coverage.contractReason}</p>
    </>}
    {policy.error && <p role="alert" className="text-sm text-red-600">{policy.error.message}</p>}
    {policy.data && <BudgetSettings key={policy.data.policy.updated_at} policy={policy.data.policy} canEdit={policy.data.canEdit} />}
  </div>;
}
