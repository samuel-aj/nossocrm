import type { SupabaseClient } from '@supabase/supabase-js';
import type { UsageScope } from './types';

export type UsageFilters = { from: string; to: string; provider?: string; model?: string; operation?: string; scope?: UsageScope };
export type UsageAttempt = {
  id: string; account_id: string | null; conversation_id: string | null; agent_id: string | null; deal_id?: string | null;
  scope: UsageScope; operation: string; provider: string; model: string; unit: 'tokens' | 'seconds';
  status: string; reserved_amount: number; actual_amount: number | null; input_tokens: number | null;
  output_tokens: number | null; total_tokens: number | null; estimated_cost_usd: number | null; created_at: string;
};
export type UsageSummary = {
  period: { from: string; to: string; timezone: string; start: string; end: string };
  tokens: number; inputTokens: number; outputTokens: number; audioSeconds: number;
  estimatedCostUsd: number | null; unpricedOperations: number; pendingOperations: number; pendingTokens: number;
  conversationTokens: number; conversationCount: number; averageTokens: number | null; otherTokens: number;
  blockedConversations: number; operationCount: number;
  days: Array<{ date: string; tokens: number }>;
  conversations: Array<{ accountId: string; conversationId: string | null; name: string; tokens: number; costUsd: number | null; unpriced: number; pending: number }>;
  breakdown: Array<{ provider: string; model: string; operation: string; tokens: number; calls: number }>;
  options: { providers: string[]; models: string[]; operations: string[] };
  coverage: { firstMeasuredAt: string | null; historical: 'partial'; contracts: ContractUsage; contractReason: string };
};

export const USAGE_OPERATION_LABELS: Record<string, string> = {
  reply: 'Resposta', safety: 'Revisão de segurança', helper: 'Agente auxiliar', action_variables: 'Variáveis de ação',
  image: 'Leitura de imagem', transcription: 'Transcrição', embedding: 'Busca de conhecimento', test: 'Simulador', assist: 'Configuração',
  image_understanding: 'Leitura de imagem', audio_transcription: 'Transcrição de áudio', audio_understanding: 'Compreensão de áudio', agent_configuration: 'Configuração do agente',
};
export const USAGE_SCOPE_LABELS: Record<UsageScope, string> = {
  conversation: 'Atendimentos', test: 'Simulador', configuration: 'Configuração', knowledge: 'Conhecimento', crm: 'Outros recursos',
};

export function validTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
}
export function localDay(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}
/** Calendar bounds in the configured organization timezone; the end is exclusive. */
export function usagePeriod(from: string, to: string, timezone: string): UsageSummary['period'] {
  if (!validDay(from) || !validDay(to) || from > to || !validTimezone(timezone)) throw new Error('Período ou fuso inválido');
  const midnight = (day: string) => {
    const target = Date.parse(`${day}T00:00:00Z`);
    let result = target;
    for (let i = 0; i < 4; i++) {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(result));
      const get = (type: string) => p.find(x => x.type === type)?.value;
      const wall = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
      const next = result + target - wall;
      if (next === result) break;
      result = next;
    }
    return new Date(result).toISOString();
  };
  const nextDay = new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const start = midnight(from); const end = midnight(nextDay);
  if (Date.parse(end) - Date.parse(start) > 367 * 86400000) throw new Error('Selecione até um ano por consulta');
  return { from, to, timezone, start, end };
}

const numeric = (value: number | string | null | undefined) => Number(value ?? 0);
const at = (value: string) => Date.parse(value);
const pending = (row: UsageAttempt) => ['reserved', 'dispatched', 'unknown'].includes(row.status);
export function summarizeUsage(rows: UsageAttempt[], period: UsageSummary['period'], blockedConversations = 0): UsageSummary {
  const filtered = rows.filter(r => at(r.created_at) >= at(period.start) && at(r.created_at) < at(period.end));
  const measured = filtered.filter(r => r.status === 'completed');
  const conversationRows = measured.filter(r => r.scope === 'conversation' && r.account_id);
  const tokensFor = (r: UsageAttempt) => r.unit === 'tokens' ? numeric(r.total_tokens ?? r.actual_amount) : 0;
  const conversationTokens = conversationRows.reduce((n, r) => n + tokensFor(r), 0);
  const accounts = new Set(conversationRows.map(r => r.account_id));
  const days = new Map<string, number>(); const breakdown = new Map<string, UsageSummary['breakdown'][number]>();
  const conversations = new Map<string, UsageSummary['conversations'][number] & { priced: boolean }>();
  for (const row of filtered) {
    if (row.scope === 'conversation' && row.account_id) {
      const c = conversations.get(row.account_id) ?? { accountId: row.account_id, conversationId: row.conversation_id, name: 'Atendimento', tokens: 0, costUsd: 0, unpriced: 0, pending: 0, priced: false };
      if (row.status === 'completed') {
        c.tokens += tokensFor(row);
        if (row.estimated_cost_usd !== null) { c.costUsd = numeric(c.costUsd) + numeric(row.estimated_cost_usd); c.priced = true; }
        else c.unpriced++;
      }
      if (pending(row)) c.pending++;
      conversations.set(row.account_id, c);
    }
    if (row.status !== 'completed') continue;
    const tokens = tokensFor(row); const day = localDay(row.created_at, period.timezone);
    days.set(day, (days.get(day) ?? 0) + tokens);
    const key = JSON.stringify([row.provider, row.model, row.operation]);
    const item = breakdown.get(key) ?? { provider: row.provider, model: row.model, operation: row.operation, tokens: 0, calls: 0 };
    item.tokens += tokens; item.calls++; breakdown.set(key, item);
  }
  const priced = measured.filter(r => r.estimated_cost_usd !== null);
  const tokens = measured.reduce((n, r) => n + tokensFor(r), 0);
  return {
    period, tokens, inputTokens: measured.reduce((n, r) => n + numeric(r.input_tokens), 0), outputTokens: measured.reduce((n, r) => n + numeric(r.output_tokens), 0),
    audioSeconds: measured.filter(r => r.unit === 'seconds').reduce((n, r) => n + numeric(r.actual_amount), 0),
    estimatedCostUsd: priced.length ? priced.reduce((n, r) => n + numeric(r.estimated_cost_usd), 0) : null,
    unpricedOperations: measured.length - priced.length, pendingOperations: filtered.filter(pending).length,
    pendingTokens: filtered.filter(r => pending(r) && r.unit === 'tokens').reduce((n, r) => n + numeric(r.reserved_amount), 0),
    conversationTokens, conversationCount: accounts.size, averageTokens: accounts.size ? conversationTokens / accounts.size : null,
    otherTokens: tokens - conversationTokens, blockedConversations, operationCount: filtered.length,
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, tokens]) => ({ date, tokens })),
    conversations: [...conversations.values()].sort((a, b) => b.tokens - a.tokens).map(({ priced: hasPrice, ...c }) => ({ ...c, costUsd: hasPrice ? c.costUsd : null })),
    breakdown: [...breakdown.values()].sort((a, b) => b.tokens - a.tokens),
    options: { providers: [...new Set(rows.map(r => r.provider))].sort(), models: [...new Set(rows.map(r => r.model))].sort(), operations: [...new Set(rows.map(r => r.operation))].sort() },
    coverage: { firstMeasuredAt: null, historical: 'partial', contracts: { wonDeals: 0, coveredDeals: 0, excludedDeals: 0, pricedDeals: 0, tokens: 0, averageTokens: null, averageCostUsd: null }, contractReason: 'Histórico anterior e vínculos com contratos não têm cobertura integral comprovada.' },
  };
}

const COLUMNS = 'id,account_id,conversation_id,agent_id,deal_id,scope,operation,provider,model,unit,status,reserved_amount,actual_amount,input_tokens,output_tokens,total_tokens,estimated_cost_usd,created_at';
/** Every page is read. A failed page aborts the report instead of presenting a partial total. */
export async function readUsageAttempts(admin: SupabaseClient, organizationId: string, period: UsageSummary['period']): Promise<UsageAttempt[]> {
  const rows: UsageAttempt[] = []; const pageSize = 500;
  let cursor: string | null = null;
  for (;;) {
    let query = admin.from('ai_usage_attempts').select(COLUMNS).eq('organization_id', organizationId)
      .gte('created_at', period.start).lt('created_at', period.end).order('id');
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.limit(pageSize);
    if (error) throw new Error('Não foi possível consultar todo o consumo');
    rows.push(...(data ?? []) as UsageAttempt[]);
    if ((data ?? []).length < pageSize) return rows;
    cursor = data![data!.length - 1].id;
  }
}

export type WonEvent = { deal_id: string; occurred_at: string; deal_created_at: string | null };
export type ContractUsage = { wonDeals: number; coveredDeals: number; excludedDeals: number; pricedDeals: number; tokens: number; averageTokens: number | null; averageCostUsd: number | null };
/** A first gain is counted once. Missing lineage, pre-metering leads and pending usage exclude the whole deal. */
export function summarizeContractUsage(rows: UsageAttempt[], wins: WonEvent[], measurementStart: string | null, period: UsageSummary['period']): ContractUsage {
  const first = new Map<string, WonEvent>();
  for (const event of wins) if (!first.has(event.deal_id) || at(event.occurred_at) < at(first.get(event.deal_id)!.occurred_at)) first.set(event.deal_id, event);
  const selected = [...first.values()].filter(w => at(w.occurred_at) >= at(period.start) && at(w.occurred_at) < at(period.end));
  let coveredDeals = 0; let pricedDeals = 0; let tokens = 0; let cost = 0;
  for (const won of selected) {
    if (!measurementStart || !won.deal_created_at || at(won.deal_created_at) < at(measurementStart)) continue;
    const linked = rows.filter(r => r.scope === 'conversation' && r.deal_id === won.deal_id && at(r.created_at) <= at(won.occurred_at));
    const accounts = new Set(linked.map(r => r.account_id).filter(Boolean));
    if (!linked.length || !accounts.size || linked.some(r => pending(r) || (r.status === 'completed' && r.actual_amount === null))) continue;
    if (rows.some(r => r.scope === 'conversation' && accounts.has(r.account_id) && at(r.created_at) <= at(won.occurred_at) && r.deal_id !== won.deal_id)) continue;
    const completed = linked.filter(r => r.status === 'completed');
    if (!completed.length) continue;
    coveredDeals++;
    tokens += completed.filter(r => r.unit === 'tokens').reduce((n, r) => n + numeric(r.total_tokens ?? r.actual_amount), 0);
    if (completed.every(r => r.estimated_cost_usd !== null)) { pricedDeals++; cost += completed.reduce((n, r) => n + numeric(r.estimated_cost_usd), 0); }
  }
  return { wonDeals: selected.length, coveredDeals, excludedDeals: selected.length - coveredDeals, pricedDeals, tokens, averageTokens: coveredDeals ? tokens / coveredDeals : null, averageCostUsd: pricedDeals ? cost / pricedDeals : null };
}

export async function readFirstGainEvents(admin: SupabaseClient, orgId: string, before: string, asOf = new Date().toISOString()): Promise<WonEvent[]> {
  const rows: WonEvent[] = [];
  let cursor: string | null = null;
  for (;;) {
    let query = admin.from('deal_lifecycle_events').select('id,deal_id,occurred_at,deal_created_at').eq('organization_id', orgId)
      .eq('event_type', 'won').lt('occurred_at', before).lte('recorded_at', asOf).order('id');
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.limit(500);
    if (error) throw new Error('Não foi possível consultar os marcos de ganho');
    rows.push(...(data ?? []) as WonEvent[]); if ((data ?? []).length < 500) return rows;
    cursor = data![data!.length - 1].id;
  }
}

export type UsageAccountLink = { id: string; merged_into: string | null };
export function usageAccountRoots(links: UsageAccountLink[]): Map<string, string> {
  const parents = new Map(links.map(r => [r.id, r.merged_into])); const result = new Map<string, string>();
  for (const link of links) {
    const seen = new Set<string>(); let current = link.id;
    while (parents.get(current)) {
      if (seen.has(current)) throw new Error('Vínculo de atendimento inconsistente');
      seen.add(current); current = parents.get(current)!;
    }
    result.set(link.id, current);
  }
  return result;
}
export function canonicalizeUsageAccounts(rows: UsageAttempt[], roots: Map<string, string>): UsageAttempt[] {
  return rows.map(row => row.account_id ? { ...row, account_id: roots.get(row.account_id) ?? row.account_id } : row);
}
export async function readUsageAccountLinks(admin: SupabaseClient, orgId: string): Promise<UsageAccountLink[]> {
  const rows: UsageAccountLink[] = [];
  let cursor: string | null = null;
  for (;;) {
    let query = admin.from('ai_usage_accounts').select('id,merged_into').eq('organization_id', orgId).order('id');
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.limit(500);
    if (error) throw new Error('Não foi possível consultar os vínculos dos atendimentos');
    rows.push(...(data ?? []) as UsageAccountLink[]); if ((data ?? []).length < 500) return rows;
    cursor = data![data!.length - 1].id;
  }
}
