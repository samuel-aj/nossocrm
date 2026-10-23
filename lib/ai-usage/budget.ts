import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveUsageAccount } from './identity';
import type { ConversationBudget, CreateUsageContextInput, ReserveUsageInput, SettleUsageInput, UsageContext, UsagePolicy, UsageReservation } from './types';
export type { UsageContext, UsagePolicy, ConversationBudget } from './types';

async function rpc<T>(admin: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name, args);
  if (error || data === null) throw new Error(`Controle de consumo indisponível: ${error?.message ?? name}`);
  return data as T;
}
export async function getUsagePolicy(admin: SupabaseClient, organizationId: string): Promise<UsagePolicy> {
  return rpc(admin, 'ai_usage_policy_get', { p_org: organizationId });
}
export async function updateUsagePolicy(admin: SupabaseClient, organizationId: string, patch: Partial<Pick<UsagePolicy, 'enabled' | 'conversation_tokens' | 'organization_daily_tokens' | 'conversation_audio_seconds' | 'timezone'>>): Promise<UsagePolicy> {
  return rpc(admin, 'ai_usage_policy_set', { p_org: organizationId, p_patch: patch });
}
export async function createUsageContext(admin: SupabaseClient, input: CreateUsageContextInput): Promise<UsageContext> {
  const accountId = input.conversationId ? await resolveUsageAccount(admin, input.organizationId, input.conversationId) : null;
  const policy = await getUsagePolicy(admin, input.organizationId);
  return { admin, organizationId: input.organizationId, conversationId: input.conversationId ?? null,
    accountId, agentId: input.agentId ?? null, runId: input.runId ?? null, dealId: input.dealId ?? null,
    scope: input.scope ?? input.purpose ?? (input.conversationId ? 'conversation' : 'configuration'), policyEnabled: policy.enabled };
}
export async function reserveUsage(ctx: UsageContext, input: ReserveUsageInput): Promise<UsageReservation> {
  return rpc(ctx.admin, 'ai_usage_reserve', { p_input: { organization_id: ctx.organizationId, account_id: ctx.accountId,
    conversation_id: ctx.conversationId, agent_id: ctx.agentId, run_id: ctx.runId, deal_id: ctx.dealId, scope: ctx.scope,
    idempotency_key: input.idempotencyKey, operation: input.operation, provider: input.provider, model: input.model,
    unit: input.unit, reserved_amount: input.reservedAmount, metadata: input.metadata ?? {} } });
}
/** Exactly one worker may dispatch; replays and abandoned reserved attempts cannot authorize a second call. */
export async function dispatchUsage(ctx: UsageContext, attemptId: string): Promise<boolean> {
  return rpc(ctx.admin, 'ai_usage_dispatch', { p_org: ctx.organizationId, p_attempt: attemptId });
}
export async function settleUsage(ctx: UsageContext, attemptId: string, input: SettleUsageInput): Promise<void> {
  await rpc(ctx.admin, 'ai_usage_settle', { p_org: ctx.organizationId, p_attempt: attemptId, p_result: input });
}
export async function checkConversationBudget(admin: SupabaseClient, organizationId: string, conversationId: string): Promise<ConversationBudget> {
  return rpc(admin, 'ai_usage_budget', { p_org: organizationId, p_conversation: conversationId });
}
export async function blockConversationBudget(ctx: UsageContext, reason: string): Promise<void> {
  if (!ctx.accountId) return;
  await rpc(ctx.admin, 'ai_usage_block', { p_org: ctx.organizationId, p_account: ctx.accountId, p_conversation: ctx.conversationId, p_reason: reason });
}
/** Caller authenticates responsible/admin; SQL checks actor membership and stores an immutable grant. */
export async function grantConversationBudget(admin: SupabaseClient, input: {
  organizationId: string; conversationId: string; actorId: string; reason: string; tokens: number; seconds?: number; idempotencyKey: string;
}): Promise<ConversationBudget> {
  await rpc(admin, 'ai_usage_grant', { p_input: { organization_id: input.organizationId, conversation_id: input.conversationId,
    actor_id: input.actorId, reason: input.reason, tokens: input.tokens, seconds: input.seconds ?? 0, idempotency_key: input.idempotencyKey } });
  return checkConversationBudget(admin, input.organizationId, input.conversationId);
}
