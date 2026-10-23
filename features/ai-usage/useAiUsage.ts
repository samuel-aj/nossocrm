'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { queryKeys } from '@/lib/query/queryKeys';
import { waAgentsFetch } from '@/features/wa-agents/useWaAgents';
import type { ConversationBudget, UsagePolicy } from '@/lib/ai-usage/types';
import type { UsageFilters, UsageSummary } from '@/lib/ai-usage/reporting';

export type BudgetGrant = { id: string; actor_id: string; reason: string; tokens: number; seconds: number; created_at: string };
export type ConversationUsageResult = { budget: ConversationBudget; canGrant: boolean; grants: BudgetGrant[] };
export type PolicyInput = Pick<UsagePolicy, 'enabled' | 'conversation_tokens' | 'organization_daily_tokens' | 'conversation_audio_seconds' | 'timezone'>;
function useOrgId() { return useAuth().profile?.organization_id ?? ''; }
export function useUsagePolicy() {
  const org = useOrgId();
  return useQuery({ queryKey: queryKeys.aiUsage.policy(org), enabled: !!org, queryFn: () => waAgentsFetch<{ policy: UsagePolicy; canEdit: boolean }>('/api/ai-usage/policy'), staleTime: 30000 });
}
export function useSaveUsagePolicy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: PolicyInput) => waAgentsFetch<{ policy: UsagePolicy }>('/api/ai-usage/policy', { method: 'PATCH', body }), onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.aiUsage.all }); } });
}
export function useUsageSummary(filters: UsageFilters) {
  const org = useOrgId(); const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return useQuery({ queryKey: queryKeys.aiUsage.summary(org, filters), enabled: !!org && !!filters.from && !!filters.to, queryFn: () => waAgentsFetch<UsageSummary>(`/api/ai-usage/summary?${params}`), staleTime: 30000, refetchInterval: 60000 });
}
export function useConversationUsage(id: string) {
  const org = useOrgId();
  return useQuery({ queryKey: queryKeys.aiUsage.conversation(org, id), enabled: !!org && !!id, queryFn: () => waAgentsFetch<ConversationUsageResult>(`/api/ai-usage/conversations/${id}`), staleTime: 15000, refetchInterval: 30000 });
}
export function useGrantUsage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { tokens: number; seconds?: number; reason: string; idempotencyKey: string }) => waAgentsFetch(`/api/ai-usage/conversations/${id}/grant`, { method: 'POST', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.aiUsage.all }); void qc.invalidateQueries({ queryKey: ['waAgents'] }); void qc.invalidateQueries({ queryKey: ['board-automation-state'] }); void qc.invalidateQueries({ queryKey: ['waConversations'] }); },
  });
}
