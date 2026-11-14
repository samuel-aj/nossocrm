import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentMediaRow } from './types';
import { normalizeKeyword } from './text';

const TABLE = 'wa_agent_media_deliveries';
type Scope = { organizationId: string; conversationId: string };
type Receipt = Scope & { key: string; attempt: string };

/** Uploaded assets have immutable paths. Renaming the same asset does not resend it. */
export function mediaDeliveryKey(media: Pick<AgentMediaRow, 'storage_path'>): string {
  return createHash('sha256').update(media.storage_path).digest('hex');
}

/** Includes uncertain dispatches: without a provider acknowledgement, never assume it failed. */
export async function deliveredMediaNames(db: SupabaseClient, scope: Scope, media: AgentMediaRow[], previous: string[] = []): Promise<Set<string>> {
  const once = media.filter(item => item.send_once_per_conversation !== false);
  const protectedNames = new Set(once.map(item => normalizeKeyword(item.name)));
  const names = new Set(previous.map(normalizeKeyword).filter(name => protectedNames.has(name)));
  if (!once.length) return names;
  const { data, error } = await db.from(TABLE).select('media_key')
    .eq('organization_id', scope.organizationId).eq('conversation_id', scope.conversationId)
    .in('state', ['sending', 'sent']);
  if (error) throw new Error(`Não foi possível conferir as mídias já enviadas: ${error.message}`);
  const keys = new Set((data ?? []).map(row => String(row.media_key)));
  const paths = once.map(m => m.outbox_path).filter((p): p is string => !!p);
  // Successful messages from before the receipt table was introduced also count.
  if (paths.length) {
    const old = await db.from('wa_messages').select('media_url').eq('organization_id', scope.organizationId)
      .eq('conversation_id', scope.conversationId).eq('direction', 'out').eq('source', 'agent')
      .in('status', ['sent', 'delivered', 'read', 'played']).in('media_url', paths);
    if (old.error) throw new Error(`Não foi possível conferir o histórico de mídias: ${old.error.message}`);
    const sentPaths = new Set((old.data ?? []).map(row => String(row.media_url)));
    for (const item of once) if (sentPaths.has(item.outbox_path ?? '')) keys.add(mediaDeliveryKey(item));
  }
  for (const item of once) if (keys.has(mediaDeliveryKey(item))) names.add(normalizeKeyword(item.name));
  return names;
}

/** The unique database key, not a process-local set, arbitrates concurrent attempts. */
export async function reserveMediaDelivery(db: SupabaseClient, scope: Scope, media: AgentMediaRow): Promise<Receipt | null> {
  const key = mediaDeliveryKey(media);
  const attempt = randomUUID();
  const row = { organization_id: scope.organizationId, conversation_id: scope.conversationId,
    media_key: key, attempt_id: attempt, state: 'sending', updated_at: new Date().toISOString() };
  const { error } = await db.from(TABLE).insert(row);
  if (!error) return { ...scope, key, attempt };
  if (error.code !== '23505') throw new Error(`Não foi possível reservar o envio da mídia: ${error.message}`);
  // Only an explicit pre-dispatch/provider rejection may be retried. A timed-out
  // request remains 'sending' until reconciled, even after a process restart.
  const retry = await db.from(TABLE).update({ attempt_id: attempt, state: 'sending', updated_at: row.updated_at })
    .eq('organization_id', scope.organizationId).eq('conversation_id', scope.conversationId)
    .eq('media_key', key).eq('state', 'failed').select('media_key').maybeSingle();
  if (retry.error) throw new Error(`Não foi possível reservar a nova tentativa: ${retry.error.message}`);
  return retry.data ? { ...scope, key, attempt } : null;
}

export async function finishMediaDelivery(db: SupabaseClient, receipt: Receipt, state: 'sent' | 'failed'): Promise<void> {
  const { error } = await db.from(TABLE).update({ state, updated_at: new Date().toISOString() })
    .eq('organization_id', receipt.organizationId).eq('conversation_id', receipt.conversationId)
    .eq('media_key', receipt.key).eq('attempt_id', receipt.attempt);
  if (error) throw new Error(`Não foi possível registrar o resultado da mídia: ${error.message}`);
}

/** The simulator carries receipts separately from the editable text of the conversation. */
export function simulatedMediaNames(messages: Array<{ role: string; media?: string[] }>): Set<string> {
  return new Set(messages.filter(m => m.role === 'assistant').flatMap(m => m.media ?? []).map(normalizeKeyword));
}
