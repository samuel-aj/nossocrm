import type { SupabaseClient } from '@supabase/supabase-js';
import { checkConversationBudget } from '@/lib/ai-usage/budget';
import { isAiAgentsApproved } from './beta';
import { loadAgent } from './context';
import { runAgentOnConversation } from './engine';
import { checkProactiveFollowup, type ProactiveFollowup } from './proactiveFollowup';

export async function startStageFollowupAgent(admin: SupabaseClient, input: {
  organizationId: string; conversationId: string; agentId: string; instruction: string; proactive: ProactiveFollowup;
}): Promise<{ ok: true } | { ok: false; reason: string; deferredUntil?: string }> {
  if (!(await isAiAgentsApproved(admin, input.organizationId))) return { ok: false, reason: 'IA não liberada' };
  const agent = await loadAgent(admin, input.organizationId, input.agentId);
  if (!agent?.enabled) return { ok: false, reason: 'Agente desligado ou indisponível' };
  const budget = await checkConversationBudget(admin, input.organizationId, input.conversationId);
  if (budget.blocked_at) return { ok: false, reason: 'IA pausada por limite; liberação manual necessária' };
  const decision = await checkProactiveFollowup(admin, input.organizationId, input.conversationId, input.proactive);
  if (decision.kind !== 'allowed') return { ok: false, reason: decision.kind === 'cancel' ? decision.reason : 'Aguardando horário de follow-up', ...(decision.kind === 'defer' ? { deferredUntil: decision.until } : {}) };
  const { data: activated, error } = await admin.rpc('activate_stage_followup_agent', {
    p_org: input.organizationId, p_conversation: input.conversationId, p_agent: input.agentId,
    p_anchor: input.proactive.anchor,
  });
  if (error) throw new Error(error.message);
  if (!activated) return { ok: false, reason: 'Conversa mudou ou está sob atendimento de outro robô' };
  const result = await runAgentOnConversation({
    organizationId: input.organizationId, conversationId: input.conversationId, agentId: input.agentId,
    trigger: 'followup', proactive: input.proactive, forceReply: true, skipBuffer: true,
    followup: { instruction: input.instruction, silentFor: 'o período configurado nesta etapa' },
  });
  return result.status === 'ok' ? { ok: true } : { ok: false, reason: result.reason ?? 'Agente não executou o follow-up', deferredUntil: result.deferredUntil };
}
