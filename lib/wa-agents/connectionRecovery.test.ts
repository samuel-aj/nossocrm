import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { processPendingConnectionReplies, type PendingReply } from './connectionRecovery';

const h = vi.hoisted(() => ({ run: vi.fn(), follow: vi.fn() }));
vi.mock('./engine', () => ({ runAgentOnConversation: h.run }));
vi.mock('./followups', () => ({ recoverConnectionFollowup: h.follow }));

const job: PendingReply = {
  id:'job', organization_id:'org', conversation_id:'conv', connection_id:'line', agent_id:'agent',
  inbound_id:'received', rule:null, anchor_at:'2026-11-17T23:00:00Z', agent_state_at:null,
  created_at:'2026-11-18T00:00:00Z', remaining_lines:null, after_send:null, sent_ids:[],
};
function database(current: PendingReply, decision: string) {
  let available = true;
  const update = vi.fn();
  const builder = {
    update: (patch: unknown) => { update(patch); return builder; },
    eq: () => builder,
    then: (resolve: (r: unknown) => unknown) => resolve({ error:null }),
  };
  const db = { from: () => builder, rpc: async (name: string) => {
    if (name === 'wa_agent_connection_reply_decision') return { data: decision };
    if (name !== 'claim_pending_wa_agent_reply') throw new Error('unexpected RPC');
    const data = available ? [current] : [];
    available = false;
    return { data };
  } } as unknown as SupabaseClient;
  return { db, update };
}
beforeEach(() => { vi.resetAllMocks(); });
it('leaves a paused, manually answered or superseded turn alone', async () => {
  const { db, update } = database(job, 'superseded');
  await processPendingConnectionReplies(db);
  expect(update).toHaveBeenCalledWith({ state:'cancelled',reason:'superseded' });
  expect(h.run).not.toHaveBeenCalled();
});
it('returns the turn to the queue if the line went offline after the claim', async () => {
  const { db, update } = database(job, 'offline');
  await processPendingConnectionReplies(db);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ state:'pending' }));
  expect(h.run).not.toHaveBeenCalled();
});
it('passes the exact undelivered suffix and receipts to the original agent', async () => {
  const { db, update } = database({ ...job, remaining_lines:['Segunda linha'], sent_ids:['first'] },'ready');
  h.run.mockResolvedValue({ status:'ok' });
  await processPendingConnectionReplies(db);
  expect(h.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ recoveryId:'job', agentId:'agent',
    triggerMessageId:'received', recoveryLines:['Segunda linha'], recoverySentIds:['first'] }));
  expect(update).toHaveBeenCalledWith({state:'done',reason:null});
});
it('separates a rejected dispatch from an uncertain outcome', async () => {
  for (const [run, state] of [[{ status:'skipped', connectionPending:true },'pending'],
    [{ status:'error', reason:'timeout' },'review']] as const) {
    const { db, update } = database(job, 'ready');
    h.run.mockResolvedValueOnce(run);
    await processPendingConnectionReplies(db);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({state}));
  }
  expect(h.run).toHaveBeenCalledTimes(2);
});
