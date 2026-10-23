import type { SupabaseClient } from '@supabase/supabase-js';

export type UsageUnit = 'tokens' | 'seconds';
export type UsageScope = 'conversation' | 'test' | 'configuration' | 'knowledge' | 'crm';
export type UsagePolicy = {
  organization_id: string;
  enabled: boolean;
  conversation_tokens: number | null;
  organization_daily_tokens: number | null;
  conversation_audio_seconds: number | null;
  timezone: string;
  created_at: string | null;
  measurement_started_at: string | null;
  updated_at: string | null;
};
export type UsageContext = {
  admin: SupabaseClient;
  organizationId: string;
  conversationId: string | null;
  accountId: string | null;
  agentId: string | null;
  runId: string | null;
  dealId: string | null;
  policyEnabled: boolean;
  scope: UsageScope;
};
export type CreateUsageContextInput = {
  organizationId: string;
  conversationId?: string | null;
  agentId?: string | null;
  runId?: string | null;
  dealId?: string | null;
  scope?: UsageScope;
  purpose?: UsageScope;
};
export type ReserveUsageInput = {
  idempotencyKey: string;
  operation: string;
  provider: string;
  model: string;
  unit: UsageUnit;
  reservedAmount: number;
  metadata?: Record<string, unknown>;
};
export type UsageReservation = {
  allowed: boolean;
  attempt_id: string | null;
  replay: boolean;
  status: string | null;
  reason: string | null;
};
export type SettleUsageInput = {
  status: 'completed' | 'unknown' | 'cancelled';
  actualAmount?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  pricingVersion?: string | null;
  metadata?: Record<string, unknown>;
};
export type ConversationBudget = {
  account_id: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  tokens_used: number;
  tokens_reserved: number;
  tokens_granted: number;
  seconds_used: number;
  seconds_reserved: number;
  seconds_granted: number;
  policy: UsagePolicy;
};
