import { pendingRobotReturn } from './scheduledReturns';
import { loadLastInboundAt } from './lastInbound';
/**
 * Follow-ups do agente por tempo sem resposta do lead (régua em wa_ai_agents.followups).
 *
 * A cada tick: para cada agente ligado com régua, olha as conversas ATIVAS dele em que a
 * última mensagem é do agente (o lead está calado). O relógio conta da primeira mensagem
 * enviada depois da última recebida (= quando o agente ficou esperando), nunca antes de o
 * agente entrar na conversa. Cada regra dispara UMA vez por ciclo de silêncio (o ciclo é a
 * última mensagem recebida: o lead respondeu, a régua recomeça), registrado em
 * ai_state.followups. Regra 'agent' num número da API oficial só roda dentro da janela de
 * 24 h (only_in_window); fora dela a regra é pulada, e a saída é uma regra 'bot' com um
 * robô que mande um Modelo de mensagem. Regra 'bot' inicia o robô preso à conversa sem
 * parar o agente: a resposta do lead volta para o agente.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { manualContractIssued } from '@/lib/zapsign/agentContractFact';
import { loadFollowupCalendar } from './followupCalendarStore';
import { nextFollowupWindow } from './followupCalendar';
import { getServiceWindow } from '@/lib/whatsapp/serviceWindow';
import { isAiAgentsApproved } from './beta';
import { createBotRun, runBotRunNow } from './bots';
import { loadAgent } from './context';
import { runAgentOnConversation } from './engine';
import { errorMessage } from './errors';
import type { AgentFollowup, ConversationAiState } from './types';
import type { ProactiveFollowup } from './proactiveFollowup';

type ConvRow = {
  id: string;
  organization_id: string;
  ai_agent_id: string;
  connection_id: string | null;
  deal_id: string | null;
  contact_id: string | null;
  last_inbound_at: string | null;
  ai_state: ConversationAiState | null;
  ai_status_changed_at: string | null;
};

const MAX_CONVERSATIONS_PER_AGENT = 200;

export type ProcessFollowupsResult = { checked: number; fired: number; skipped: number };

/** "35 min", "3 h", "2 dias" */
export function formatSilence(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

async function isMetaConnection(admin: SupabaseClient, orgId: string, connectionId: string | null): Promise<boolean> {
  if (!connectionId) return false;
  const { data } = await admin
    .from('wa_connections')
    .select('provider')
    .eq('organization_id', orgId)
    .eq('id', connectionId)
    .maybeSingle();
  return String((data as { provider?: string | null } | null)?.provider ?? '').toLowerCase() === 'meta_cloud';
}

/** Início do silêncio: primeira mensagem enviada depois da última recebida (e depois de o agente entrar). */
async function silenceStartedAt(admin: SupabaseClient, conv: ConvRow): Promise<number | null> {
  let q = admin
    .from('wa_messages')
    .select('created_at')
    .eq('organization_id', conv.organization_id)
    .eq('conversation_id', conv.id)
    .eq('direction', 'out');
  if (conv.last_inbound_at) q = q.gt('created_at', conv.last_inbound_at);
  const { data } = await q.order('created_at', { ascending: true }).limit(1);
  const first = (data as Array<{ created_at: string }> | null)?.[0]?.created_at;
  if (!first) return null;
  const started = Date.parse(first);
  if (!Number.isFinite(started)) return null;
  const since = conv.ai_status_changed_at ? Date.parse(conv.ai_status_changed_at) : NaN;
  return Number.isFinite(since) ? Math.max(started, since) : started;
}

export async function processFollowups(
  admin: SupabaseClient,
  opts: { limit?: number; deadlineMs?: number } = {}
): Promise<ProcessFollowupsResult> {
  const result: ProcessFollowupsResult = { checked: 0, fired: 0, skipped: 0 };
  const limit = opts.limit ?? 5;
  try {
    const { data: agentsRaw } = await admin
      .from('wa_ai_agents')
      .select('id, organization_id, followups')
      .eq('enabled', true);
    const withRules = ((agentsRaw ?? []) as Array<{ id: string; organization_id: string; followups: unknown }>).filter(
      a => Array.isArray(a.followups) && a.followups.length > 0
    );
    const betaByOrg = new Map<string, boolean>();
    for (const a of withRules) {
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
      if (result.fired >= limit) break;
      let beta = betaByOrg.get(a.organization_id);
      if (beta === undefined) {
        beta = await isAiAgentsApproved(admin, a.organization_id);
        betaByOrg.set(a.organization_id, beta);
      }
      if (!beta) continue;
      const now = new Date();
      const calendar = await loadFollowupCalendar(admin, a.organization_id);
      if (nextFollowupWindow(calendar, now) > now) continue;
      const agent = await loadAgent(admin, a.organization_id, a.id);
      if (!agent || agent.followups.length === 0) continue;
      const rules = [...agent.followups].sort((x, y) => x.after_minutes - y.after_minutes);

      const { data: convsRaw } = await admin
        .from('wa_conversations')
        .select('id, organization_id, ai_agent_id, connection_id, deal_id, contact_id, ai_state, ai_status_changed_at')
        .eq('organization_id', a.organization_id)
        .eq('ai_agent_id', a.id)
        .eq('ai_status', 'active')
        .limit(MAX_CONVERSATIONS_PER_AGENT);
      for (const conv of (convsRaw ?? []) as ConvRow[]) {
        if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
        if (result.fired >= limit) break;
        result.checked++;
        try {
          conv.last_inbound_at = await loadLastInboundAt(admin, conv.organization_id, conv.id);
          if (await pendingRobotReturn(admin, conv.organization_id, conv.id)) continue;
          // A reviewed manual contract supersedes this agent's collection
          // sequence. Inbound replies and the signature notice remain active.
          if (await manualContractIssued(admin, {
            organizationId: conv.organization_id, dealId: conv.deal_id, contactId: conv.contact_id,
            templateToken: agent.tools?.zapsign_template_token, silentSince: conv.last_inbound_at,
          })) continue;
          const state = (conv.ai_state ?? {}) as ConversationAiState;
          const cycle = conv.last_inbound_at ?? null;
          const done = state.followups && state.followups.cycle === cycle ? [...state.followups.done] : [];
          const pending = rules.filter(r => !done.includes(r.id));
          if (pending.length === 0) continue;
          const startedAt = await silenceStartedAt(admin, conv);
          if (startedAt === null) continue; // o agente ainda não respondeu: não é silêncio do lead
          const elapsed = Date.now() - startedAt;
          const due = pending.filter(r => r.after_minutes * 60_000 <= elapsed);
          const rule = calendar.enabled ? due.at(-1) : due[0];
          if (!rule) continue;
          const consumed = calendar.enabled ? due : [rule];

          // Atomic compare-and-swap merges only this key, preserving memory and manual pauses.
          const { data: claimed, error: claimError } = await admin.rpc('claim_agent_followup', {
            p_org: conv.organization_id, p_conversation: conv.id, p_agent: conv.ai_agent_id,
            p_cycle: cycle, p_expected: state.followups ?? null,
            p_done: [...done, ...consumed.map(item => item.id)],
          });
          if (claimError) throw new Error(claimError.message);
          if (!claimed) continue;

          const fired = await fireRule(admin, conv, rule, elapsed, agent.tools?.zapsign_template_token);
          if (typeof fired === 'string') {
            // Window closed while preparing the response, before any outbound: keep it pending.
            const { error } = await admin.rpc('claim_agent_followup', {
              p_org: conv.organization_id, p_conversation: conv.id, p_agent: conv.ai_agent_id,
              p_cycle: cycle, p_expected: { cycle, done: [...done, ...consumed.map(item => item.id)] }, p_done: done,
            });
            if (error) throw new Error(error.message);
          } else if (fired) result.fired++;
          else result.skipped++;
        } catch (e) {
          console.error('[wa-agents] follow-up falhou:', errorMessage(e));
        }
      }
    }
  } catch (e) {
    console.error('[wa-agents] busca de follow-ups falhou:', errorMessage(e));
  }
  return result;
}

async function fireRule(admin: SupabaseClient, conv: ConvRow, rule: AgentFollowup, elapsedMs: number,
  templateToken?: string | null): Promise<boolean | string> {
  const proactive: ProactiveFollowup = { anchor: conv.last_inbound_at,
    ...(templateToken ? { agentFollowup: { agentId: conv.ai_agent_id, templateToken } } : {}) };
  if (rule.kind === 'bot') {
    if (!rule.bot_id) return false;
    const created = await createBotRun(admin, {
      organizationId: conv.organization_id,
      botId: rule.bot_id,
      conversationId: conv.id,
      proactive,
    });
    if (!created.ok || !created.run) {
      console.error('[wa-agents] follow-up: robô não iniciou:', created.error);
      return false;
    }
    await runBotRunNow(admin, created.run);
    return true;
  }
  // kind 'agent': na API oficial só dentro da janela de 24 h
  if (rule.only_in_window && (await isMetaConnection(admin, conv.organization_id, conv.connection_id))) {
    if (!getServiceWindow(conv.last_inbound_at).open) return false;
  }
  const run = await runAgentOnConversation({
    organizationId: conv.organization_id,
    conversationId: conv.id,
    trigger: 'followup',
    proactive,
    agentId: conv.ai_agent_id,
    forceReply: true,
    skipBuffer: true,
    followup: { instruction: rule.instruction.trim(), silentFor: formatSilence(elapsedMs) },
  });
  return run.deferredUntil ?? (run.status === 'ok');
}
