import { loadLastInboundAt } from './lastInbound';
import type { SupabaseClient } from '@supabase/supabase-js';
import { followupAllowedAt } from './followupCalendarStore';

export const PROACTIVE_VAR = '__proactive_followup';
export type ProactiveFollowup = { anchor: string | null; dealId?: string; stageId?: string; ruleVersion?: number };
export type ProactiveDecision = { kind: 'allowed' } | { kind: 'cancel'; reason: string } | { kind: 'defer'; until: string };

/** Rechecked on every scheduled robot continuation, before touching any provider. */
export async function checkProactiveFollowup(admin: SupabaseClient, orgId: string, conversationId: string | null,
  context: ProactiveFollowup, now = new Date()): Promise<ProactiveDecision> {
  if (!conversationId) return { kind: 'cancel', reason: 'follow-up sem conversa vinculada' };
  const { data: conv, error } = await admin.from('wa_conversations')
    .select('ai_status, ai_approval').eq('organization_id', orgId).eq('id', conversationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!conv) return { kind: 'cancel', reason: 'conversa não encontrada' };
  const lastInbound = await loadLastInboundAt(admin, orgId, conversationId);
  if (lastInbound && (!context.anchor || Date.parse(lastInbound) > Date.parse(context.anchor)))
    return { kind: 'cancel', reason: 'cliente respondeu após o agendamento' };
  if (['paused', 'stopped', 'awaiting_approval'].includes(conv.ai_status) || conv.ai_approval)
    return { kind: 'cancel', reason: 'atendimento pausado, encerrado ou aguardando aprovação' };
  if (context.dealId) {
    const { data: deal, error: dealError } = await admin.from('deals')
      .select('stage_id, is_won, is_lost, deleted_at').eq('organization_id', orgId).eq('id', context.dealId).maybeSingle();
    if (dealError) throw new Error(dealError.message);
    if (!deal || deal.deleted_at || deal.is_won || deal.is_lost || deal.stage_id !== context.stageId)
      return { kind: 'cancel', reason: 'lead deixou de atender à regra da etapa' };
    const { data: rule, error: ruleError } = await admin.from('stage_followup_rules')
      .select('enabled, version').eq('organization_id', orgId).eq('stage_id', context.stageId).maybeSingle();
    if (ruleError) throw new Error(ruleError.message);
    if (!rule?.enabled || rule.version !== context.ruleVersion)
      return { kind: 'cancel', reason: 'regra de follow-up alterada ou desligada' };
  }
  const allowed = await followupAllowedAt(admin, orgId, now);
  return allowed > now ? { kind: 'defer', until: allowed.toISOString() } : { kind: 'allowed' };
}
