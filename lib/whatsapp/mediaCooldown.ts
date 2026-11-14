import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SendResult } from './providers/types';

export const MEDIA_COOLDOWN_SECONDS = 60;
export const MEDIA_DISPATCH_LEASE_SECONDS = 300;
const TABLE = 'wa_media_send_cooldowns';
export type MediaCooldownReceipt = {
  organizationId: string; conversationId: string; mediaKey: string; attemptId: string;
};
export class MediaCooldownError extends Error {
  readonly code = 'MEDIA_COOLDOWN';
  constructor(readonly retryAfter: number) {
    super(`Esta mídia já está sendo enviada ou foi enviada há pouco nesta conversa. Aguarde ${retryAfter} segundos para reenviar.`);
    this.name = 'MediaCooldownError';
  }
}

/** Only a server-owned wa-media path is used; signed URL query strings never identify an asset. */
export async function claimMediaCooldown(db: SupabaseClient, scope: {
  organizationId: string; conversationId: string; mediaPath: string;
}): Promise<MediaCooldownReceipt> {
  if (!scope.mediaPath.startsWith(scope.organizationId + '/') || scope.mediaPath.includes('?') || scope.mediaPath.includes('#') ||
      scope.mediaPath.split('/').some(part => part === '.' || part === '..')) throw new Error('Caminho de mídia inválido.');
  const receipt = { organizationId: scope.organizationId, conversationId: scope.conversationId,
    mediaKey: createHash('sha256').update('wa-media/' + scope.mediaPath).digest('hex'), attemptId: randomUUID() };
  const { data, error } = await db.rpc('claim_wa_media_cooldown', {
    p_org: receipt.organizationId, p_conversation: receipt.conversationId, p_media_key: receipt.mediaKey, p_attempt: receipt.attemptId,
  });
  if (error) throw new Error(`Não foi possível conferir o envio recente da mídia: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.acquired === true) return receipt;
  if (row?.acquired === false && typeof row.retry_after_seconds === 'number' && Number.isFinite(row.retry_after_seconds)) {
    throw new MediaCooldownError(Math.max(1, Math.min(MEDIA_DISPATCH_LEASE_SECONDS, Math.ceil(row.retry_after_seconds))));
  }
  throw new Error('Não foi possível reservar o envio da mídia.');
}

/** Acquire a dispatch lease before any hooks. Covers the longest request lifetime (300s). */
export async function beginMediaCooldownDispatch(db: SupabaseClient, receipt: MediaCooldownReceipt): Promise<void> {
  const { data, error } = await db.rpc('touch_wa_media_cooldown', {
    p_org: receipt.organizationId, p_conversation: receipt.conversationId, p_media_key: receipt.mediaKey, p_attempt: receipt.attemptId,
  });
  if (error) throw new Error(`Não foi possível confirmar a reserva da mídia: ${error.message}`);
  if (data !== true) throw new MediaCooldownError(MEDIA_COOLDOWN_SECONDS);
}

/** Acknowledged sends start the 60s window. Unknown outcomes retain the dispatch lease. */
export async function finishMediaCooldownDispatch(db: SupabaseClient, receipt: MediaCooldownReceipt, result: SendResult): Promise<void> {
  const confirmed = result.ok || (!!result.raw && !result.providerMessageId && !/timeout|timed.?out|network|rede|ECONN|ETIMEDOUT/iu.test(result.error ?? ''));
  if (!confirmed) return;
  try {
    const { error } = await db.rpc('finish_wa_media_cooldown', {
      p_org: receipt.organizationId, p_conversation: receipt.conversationId, p_media_key: receipt.mediaKey, p_attempt: receipt.attemptId,
    });
    if (error) throw new Error(error.message);
  } catch {
    // Never turn an acknowledged provider result into an apparent send failure.
    console.error('[whatsapp] falha ao finalizar reserva de mídia; proteção mantida até expirar');
  }
}

/** Call only if the provider was never invoked. A stale owner cannot release a newer attempt. */
export async function releaseMediaCooldown(db: SupabaseClient, receipt: MediaCooldownReceipt): Promise<void> {
  const { error } = await db.from(TABLE).delete().eq('organization_id', receipt.organizationId)
    .eq('conversation_id', receipt.conversationId).eq('media_key', receipt.mediaKey).eq('attempt_id', receipt.attemptId);
  if (error) throw new Error(`Não foi possível liberar a reserva da mídia: ${error.message}`);
}
