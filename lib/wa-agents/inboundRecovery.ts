import type { SupabaseClient } from '@supabase/supabase-js';
import { handleInboundMessage, type InboundDelivery } from './engine';

export type InboundMessageKey = { organization_id: string; conversation_id: string; message_id: string };
type Work = InboundMessageKey & { lease_token: string; completed_steps: string[] };
type Step = Parameters<InboundDelivery['beginStep']>[0];
type Outcome = 'done' | 'cancelled' | 'retry' | 'review';

async function processEntry(admin: SupabaseClient, row: Work) {
  const lease = { p_message_id: row.message_id, p_lease_token: row.lease_token };
  let inFlight: Step | null = null;
  let ownsLease = true;

  async function advance(step: Step, finished: boolean) {
    if (!ownsLease) throw new Error('Reserva de processamento indisponível.');
    // An RPC timeout can mean that Postgres committed but we missed its reply.
    // Leave the decision to lease recovery instead of authorizing another effect.
    ownsLease = false;
    let state: string | null;
    try {
      const { data, error } = await admin.rpc('advance_wa_inbound_work', { ...lease, p_step: step, p_finished: finished });
      if (error) throw new Error(error.message);
      state = data;
    } catch (error) {
      console.error('[wa-agents] falha ao confirmar a fase da entrada', row.message_id, step, error instanceof Error ? error.message : 'RPC indisponível');
      throw error;
    }
    if (state !== 'ready') throw new Error('A entrada já foi atendida ou a reserva expirou.');
    ownsLease = true;
    inFlight = finished ? null : step;
  }

  let outcome: Outcome;
  let reason: string | null;
  try {
    const result = await handleInboundMessage({
      organizationId: row.organization_id, conversationId: row.conversation_id, messageId: row.message_id,
      delivery: {
        completedSteps: row.completed_steps,
        beginStep: step => advance(step, false),
        finishStep: step => advance(step, true),
      },
    });
    reason = result.reason ?? null;
    switch (result.disposition) {
      case 'retry':
        outcome = inFlight ? 'review' : 'retry';
        break;
      case 'done':
        outcome = result.status === 'skipped' ? 'cancelled' : 'done';
        break;
      default:
        outcome = 'review';
    }
  } catch (error) {
    outcome = inFlight ? 'review' : 'retry';
    reason = error instanceof Error ? error.message : 'Falha ao processar a entrada.';
  }
  if (!ownsLease) return;
  const saved = await admin.rpc('finish_wa_inbound_work', { ...lease, p_outcome: outcome, p_reason: reason?.slice(0, 500) ?? null });
  if (saved.error) throw new Error(saved.error.message);
}

/** The trigger wakes up a single receipt. The clock picks up lost wake-ups and due retries. */
export async function processInboundRecovery(admin: SupabaseClient, message?: InboundMessageKey) {
  const { data, error } = await admin.rpc('claim_wa_inbound_work', {
    p_message_id: message?.message_id ?? null,
    p_org: message?.organization_id ?? null,
    p_conversation: message?.conversation_id ?? null,
    p_limit: message ? 1 : 3,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Work[];
  await Promise.all(rows.map(async row => {
    try {
      await processEntry(admin, row);
    } catch (err) {
      console.error('[wa-agents] falha ao registrar recuperação de entrada', row.message_id, err);
    }
  }));
}
