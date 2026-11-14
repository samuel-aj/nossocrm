import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mediaDeliveryKey } from './mediaDelivery';
import { normalizeKeyword } from './text';
import type { AgentMediaRow } from './types';

const TABLE = 'wa_agent_test_media_deliveries';
const REPEAT_COOLDOWN_MS = 60_000;
export type TestMediaScope = { organizationId: string; userId: string; agentId: string; sessionId: string };
export type TestMediaReceipt = TestMediaScope & { key: string; attempt: string; previousDeliveredAt?: string };

function scoped(db: SupabaseClient, scope: TestMediaScope) {
  return db.from(TABLE).select('media_key,state,updated_at').eq('organization_id', scope.organizationId)
    .eq('user_id', scope.userId).eq('agent_id', scope.agentId).eq('session_id', scope.sessionId);
}

/** Pending requests count too: two concurrent API calls cannot accept the same file. */
export async function testDeliveredMediaNames(db: SupabaseClient, scope: TestMediaScope, media: AgentMediaRow[]): Promise<Set<string>> {
  if (!media.length) return new Set();
  const { data, error } = await scoped(db, scope);
  if (error) throw new Error(`Não foi possível consultar as mídias desta simulação: ${error.message}`);
  const rows = new Map((data ?? []).map(row => [String(row.media_key), row]));
  return new Set(media.filter(item => {
    const row = rows.get(mediaDeliveryKey(item));
    if (!row) return false;
    if (item.send_once_per_conversation !== false || row.state === 'pending') return true;
    const deliveredAt = Date.parse(row.updated_at);
    return !Number.isFinite(deliveredAt) || deliveredAt > Date.now() - REPEAT_COOLDOWN_MS;
  }).map(item => normalizeKeyword(item.name)));
}

export async function reserveTestMedia(db: SupabaseClient, scope: TestMediaScope, media: AgentMediaRow): Promise<TestMediaReceipt | null> {
  const receipt = { ...scope, key: mediaDeliveryKey(media), attempt: randomUUID() };
  const { error } = await db.from(TABLE).insert({
    organization_id: scope.organizationId, user_id: scope.userId, agent_id: scope.agentId,
    session_id: scope.sessionId, media_key: receipt.key, attempt_id: receipt.attempt, state: 'pending',
  });
  if (error?.code === '23505') {
    if (media.send_once_per_conversation !== false) return null;
    const previous = await scoped(db, scope).eq('media_key', receipt.key).eq('state', 'delivered')
      .lte('updated_at', new Date(Date.now() - REPEAT_COOLDOWN_MS).toISOString()).maybeSingle();
    if (previous.error) throw new Error(`Não foi possível consultar a tentativa anterior simulada: ${previous.error.message}`);
    if (!previous.data) return null;
    const previousDeliveredAt = String(previous.data.updated_at);
    const { data, error: retryError } = await db.from(TABLE).update({ state: 'pending', attempt_id: receipt.attempt, updated_at: new Date().toISOString() })
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('agent_id', scope.agentId)
      .eq('session_id', scope.sessionId).eq('media_key', receipt.key).eq('state', 'delivered')
      .eq('updated_at', previousDeliveredAt).select('media_key').maybeSingle();
    if (retryError) throw new Error(`Não foi possível reservar a nova tentativa simulada: ${retryError.message}`);
    return data ? { ...receipt, previousDeliveredAt } : null;
  }
  if (error) throw new Error(`Não foi possível reservar a mídia desta simulação: ${error.message}`);
  return receipt;
}

/** Only the request that reserved a simulated file can commit or undo its receipt. */
export async function settleTestMedia(db: SupabaseClient, receipts: TestMediaReceipt[], delivered: boolean): Promise<void> {
  for (const receipt of receipts) {
    const query = delivered
      ? db.from(TABLE).update({ state: 'delivered', updated_at: new Date().toISOString() })
      : receipt.previousDeliveredAt
        ? db.from(TABLE).update({ state: 'delivered', updated_at: receipt.previousDeliveredAt })
        : db.from(TABLE).delete();
    const { error } = await query.eq('organization_id', receipt.organizationId).eq('user_id', receipt.userId)
      .eq('agent_id', receipt.agentId).eq('session_id', receipt.sessionId)
      .eq('media_key', receipt.key).eq('attempt_id', receipt.attempt);
    if (error) throw new Error(`Não foi possível registrar o resultado da mídia simulada: ${error.message}`);
  }
}
