import { loadLastInboundAt } from './lastInbound';
import { checkConversationBudget } from '@/lib/ai-usage/budget';
import type { SupabaseClient } from '@supabase/supabase-js';
import { followupAllowedAt } from './followupCalendarStore';

export const PROACTIVE_VAR = '__proactive_followup';
export type ProactiveFollowup = { anchor: string | null; dealId?: string; stageId?: string; ruleVersion?: number; scheduledReturnId?: string };
export type ProactiveDecision = { kind: 'allowed' } | { kind: 'cancel'; reason: string } | { kind: 'defer'; until: string };

/** Rechecked on every scheduled robot continuation, before touching any provider. */
export async function checkProactiveFollowup(admin: SupabaseClient, orgId: string, conversationId: string | null,
  context: ProactiveFollowup, now = new Date()): Promise<ProactiveDecision> {
  if (!conversationId) return { kind: 'cancel', reason: 'follow-up sem conversa vinculada' };
  const { data: conv, error } = await admin.from('wa_conversations')
    .select('ai_status, ai_approval, connection_id').eq('organization_id', orgId).eq('id', conversationId).maybeSingle();
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
  if (context.scheduledReturnId) {
    const { data: saved, error: savedError } = await admin.from('wa_bot_runs')
      .select('scheduled_for, scheduled_connection_id, scheduled_anchor, status')
      .eq('organization_id', orgId).eq('conversation_id', conversationId).eq('id', context.scheduledReturnId).maybeSingle();
    if (savedError) throw new Error(savedError.message);
    if (!saved?.scheduled_for || ['cancelled', 'error'].includes(saved.status) || saved.scheduled_connection_id !== conv.connection_id || (saved.scheduled_anchor ? Date.parse(saved.scheduled_anchor) : null) !== (context.anchor ? Date.parse(context.anchor) : null))
      return { kind: 'cancel', reason: 'retorno cancelado ou vínculo alterado' };
    if ((await checkConversationBudget(admin, orgId, conversationId)).blocked_at)
      return { kind: 'cancel', reason: 'IA pausada por limite; liberação manual necessária' };
    const due = Date.parse(saved.scheduled_for);
    if (now.getTime() < due) return { kind: 'defer', until: saved.scheduled_for };
    // This execution is the explicitly agreed return, including retries after
    // a worker delay. Ordinary follow-ups never inherit this exception.
    return { kind: 'allowed' };
  } else {
    const { data: returns, error: returnError } = await admin.from('wa_bot_runs')
      .select('scheduled_for, scheduled_anchor').eq('organization_id', orgId).eq('conversation_id', conversationId)
      .in('status', ['running', 'waiting_reply']).not('scheduled_for', 'is', null).limit(1).maybeSingle();
    if (returnError) throw new Error(returnError.message);
    if (returns?.scheduled_for && (!lastInbound || (returns.scheduled_anchor && Date.parse(lastInbound) <= Date.parse(returns.scheduled_anchor))))
      return { kind: 'defer', until: new Date(Math.max(Date.parse(returns.scheduled_for), now.getTime() + 60_000)).toISOString() };
  }
  const allowed = await followupAllowedAt(admin, orgId, now);
  return allowed > now ? { kind: 'defer', until: allowed.toISOString() } : { kind: 'allowed' };
}
