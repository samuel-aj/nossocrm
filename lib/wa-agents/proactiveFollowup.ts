import { loadLastInboundAt } from './lastInbound';
import { checkConversationBudget } from '@/lib/ai-usage/budget';
import type { SupabaseClient } from '@supabase/supabase-js';
import { followupAllowedAt } from './followupCalendarStore';
import { manualContractIssued } from '@/lib/zapsign/agentContractFact';
import { contractConfirmationDue } from './contractConfirmation';

export const PROACTIVE_VAR = '__proactive_followup';
export type ProactiveFollowup = { anchor: string | null; dealId?: string; stageId?: string; ruleVersion?: number; scheduledReturnId?: string;
  connectionRecovery?: { since: string; line: string; agent: string | null; stateAt: string | null };
  agentFollowup?: { agentId: string; templateToken: string } };
export type ProactiveDecision = { kind: 'allowed' } | { kind: 'cancel'; reason: string } | { kind: 'defer'; until: string };

/** Only called after this execution has atomically transferred the conversation. */
export async function bindRecoveredHandoff(admin: SupabaseClient, org: string, id: string, context: ProactiveFollowup, agent: string) {
  if (!context.connectionRecovery) return context;
  const { data, error } = await admin.from('wa_conversations').select('ai_agent_id,ai_status,ai_status_changed_at')
    .eq('organization_id',org).eq('id',id).maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.ai_status !== 'active' || data.ai_agent_id !== agent) throw new Error('Atendimento alterado após a transferência.');
  return { ...context, connectionRecovery: { ...context.connectionRecovery, agent, stateAt: data.ai_status_changed_at } };
}

/** Rechecked on every scheduled robot continuation, before touching any provider. */
export async function checkProactiveFollowup(admin: SupabaseClient, orgId: string, conversationId: string | null,
  context: ProactiveFollowup, now = new Date()): Promise<ProactiveDecision> {
  if (!conversationId) return { kind: 'cancel', reason: 'follow-up sem conversa vinculada' };
  const { data: conv, error } = await admin.from('wa_conversations')
    .select('ai_status, ai_status_changed_at, ai_approval, connection_id, wa_phone, ai_agent_id, deal_id, contact_id').eq('organization_id', orgId).eq('id', conversationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!conv) return { kind: 'cancel', reason: 'conversa não encontrada' };
  const lastInbound = await loadLastInboundAt(admin, orgId, conversationId);
  if (lastInbound && (!context.anchor || Date.parse(lastInbound) > Date.parse(context.anchor)))
    return { kind: 'cancel', reason: 'cliente respondeu após o agendamento' };
  if (['paused', 'stopped', 'awaiting_approval'].includes(conv.ai_status) || conv.ai_approval)
    return { kind: 'cancel', reason: 'atendimento pausado, encerrado ou aguardando aprovação' };
  if (context.connectionRecovery) {
    const recovery = context.connectionRecovery;
    if (conv.connection_id !== recovery.line || conv.ai_agent_id !== recovery.agent ||
      conv.ai_status_changed_at !== recovery.stateAt) return { kind: 'cancel', reason: 'Atendimento alterado após a desconexão.' };
    const { data: handled, error: lookupError } = await admin.from('wa_messages').select('id')
      .eq('organization_id', orgId).eq('conversation_id', conversationId).eq('direction','out')
      .in('source', ['crm','echo','api']).gte('created_at', recovery.since).limit(1).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (handled) return { kind: 'cancel', reason: 'Conversa já atendida após a desconexão.' };
    if ((await checkConversationBudget(admin, orgId, conversationId)).blocked_at)
      return { kind: 'cancel', reason: 'IA pausada por consumo.' };
    const { data: line, error: lineError } = await admin.from('wa_connections')
      .select('status,health_monitor_enabled,health_identity_mismatch_at,health_uncertain_since')
      .eq('organization_id', orgId).eq('id', recovery.line).maybeSingle();
    if (lineError) throw new Error(lineError.message);
    if (!line || !line.health_monitor_enabled) return { kind: 'cancel', reason: 'Número removido ou desligado.' };
    if (line.status !== 'connected' || line.health_identity_mismatch_at || line.health_uncertain_since)
      return { kind: 'defer', until: new Date(now.getTime() + 60_000).toISOString() };
    const { data: incident, error: incidentError } = await admin.from('wa_connection_incidents').select('id')
      .eq('organization_id', orgId).eq('connection_id',recovery.line).is('resolved_at',null).limit(1).maybeSingle();
    if (incidentError) throw new Error(incidentError.message);
    if (incident) return { kind: 'defer', until: new Date(now.getTime() + 60_000).toISOString() };
  }
  // This marker belongs only to the agent's old silence sequence, never to an
  // independently scheduled return or a board's inactivity automation.
  if (context.agentFollowup) {
    if (conv.ai_agent_id !== context.agentFollowup.agentId)
      return { kind: 'cancel', reason: 'agente responsável pelo follow-up foi alterado' };
    const due = await contractConfirmationDue(admin, orgId, conversationId, conv, now);
    if (due) return { kind: 'defer', until: due };
    if (await manualContractIssued(admin, {
      organizationId: orgId, dealId: conv.deal_id, contactId: conv.contact_id,
      templateToken: context.agentFollowup.templateToken, silentSince: context.anchor,
    })) return { kind: 'cancel', reason: 'a equipe já emitiu o contrato deste atendimento' };
  }
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
