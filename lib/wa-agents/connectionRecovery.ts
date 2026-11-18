import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentFollowup } from './types';
import type { RunResult } from './engine';
import type { CollectedToolCall } from './replyGeneration';

export type AfterPendingSend = { toolCalls: CollectedToolCall[]; contractReviewKey?: string };

export type PendingReply = {
  id: string;
  organization_id: string;
  conversation_id: string;
  connection_id: string;
  agent_id: string;
  inbound_id: string | null;
  rule: AgentFollowup | null;
  anchor_at: string | null;
  agent_state_at: string | null;
  created_at: string;
  remaining_lines: string[] | null;
  after_send: AfterPendingSend | null;
  sent_ids: string[];
};

export async function enqueueDisconnectedTurn(admin: SupabaseClient, job: {
  org: string; conversation: string; connection: string; agent: string; stateAt: string | null;
  inbound?: string; rule?: AgentFollowup; anchor?: string | null; lines?: string[]; sentIds?: string[]; started?: string;
  afterSend?: AfterPendingSend;
}) {
  const { error } = await admin.rpc('enqueue_wa_agent_connection_reply', {
    p_org: job.org, p_conversation: job.conversation, p_connection: job.connection, p_agent: job.agent,
    p_inbound: job.inbound ?? null, p_rule: job.rule ?? null, p_cycle: job.anchor ?? null, p_state_at: job.stateAt,
    p_lines: job.lines ?? null, p_sent: job.sentIds ?? [], p_started: job.started ?? null,
    p_after_send: job.afterSend ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function pendingReplyDecision(admin: SupabaseClient, id: string, started = false) {
  const { data, error } = await admin.rpc('wa_agent_connection_reply_decision', { p_id: id, p_started: started });
  if (error) throw new Error(error.message);
  if (data !== 'ready' && data !== 'offline' && data !== 'superseded') throw new Error('Decisão de recuperação desconhecida');
  return data as 'ready' | 'offline' | 'superseded';
}

async function updatePending(admin: SupabaseClient, job: PendingReply, state: string, reason: string | null, available?: string) {
  const { error } = await admin.from('wa_agent_connection_pending')
    .update({ state, reason, ...(available ? { available_at: available } : {}) })
    .eq('organization_id', job.organization_id).eq('id', job.id).eq('state', 'dispatching');
  if (error) throw new Error(error.message);
}

export async function processPendingConnectionReplies(admin: SupabaseClient, opts: { limit?: number; deadlineMs?: number } = {}) {
  let checked = 0;
  for (; checked < (opts.limit ?? 3); checked++) {
    if (opts.deadlineMs && Date.now() >= opts.deadlineMs) break;
    const { data, error } = await admin.rpc('claim_pending_wa_agent_reply');
    if (error) throw new Error(error.message);
    const job = (data as PendingReply[] | null)?.[0];
    if (!job) break;
    let handedOff = false;
    try {
      const decision = await pendingReplyDecision(admin, job.id);
      let run: RunResult = { status: 'skipped', reason: decision };
      if (decision === 'ready') {
        if (job.inbound_id) {
          const { runAgentOnConversation } = await import('./engine');
          handedOff = true;
          run = await runAgentOnConversation({
            organizationId: job.organization_id, conversationId: job.conversation_id, agentId: job.agent_id,
            trigger: 'inbound', triggerMessageId: job.inbound_id, skipBuffer: true, recoveryId: job.id,
            recoveryLines: job.remaining_lines ?? undefined, recoverySentIds: job.sent_ids,
            recoveryAfterSend: job.after_send ?? undefined,
          });
        } else {
          const { recoverConnectionFollowup } = await import('./followups');
          run = await recoverConnectionFollowup(admin, job, () => { handedOff = true; });
        }
      }
      if (run.connectionPending || run.deferredUntil || run.reason === 'locked' || decision === 'offline') {
        await updatePending(admin, job, 'pending', 'awaiting_dispatch',
          run.deferredUntil ?? new Date(Date.now() + 60_000).toISOString());
      } else if (run.status === 'error') {
        // A timeout, partial send or crash after handoff has unknown effects.
        await updatePending(admin, job, 'review', 'delivery_uncertain');
      } else {
        await updatePending(admin, job, run.status === 'ok' ? 'done' : 'cancelled',
          run.status === 'ok' ? null : 'superseded');
      }
    } catch (e) {
      await updatePending(admin, job, handedOff ? 'review' : 'pending',
        handedOff ? 'delivery_uncertain' : 'check_unavailable', new Date(Date.now() + 60_000).toISOString());
      console.error('[wa-agents] recuperação de conexão:', e instanceof Error ? e.message : 'falha');
    }
  }
  return { checked };
}
