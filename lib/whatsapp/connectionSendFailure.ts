import type { SupabaseClient } from '@supabase/supabase-js';
import { isConfirmedDisconnect, observeConnection } from './connectionIncidents';
import type { SendResult } from './providers/types';
import { metaErrorReason } from './providers/metaCloudError';
import { evolutionDisconnectReason, type EvolutionConnectionDetails } from '@/supabase/functions/whatsapp-webhook/connection-event-time';

export async function reportBlockedSend(admin: SupabaseClient, id: string) {
  await observeConnection(admin, id, 'disconnected', 'send_blocked', new Date().toISOString(), 'crm_send_blocked')
    .catch(() => console.error('[wa-connection] Falha ao registrar bloqueio local de envio.'));
}

/** Call only with a provider response. A network exception or an accepted id must never qualify for retry. */
export async function reportRejectedSend(admin: SupabaseClient, id: string, result: SendResult, startedAt: string) {
  if (result.ok || result.providerMessageId || !isConfirmedDisconnect(result.error)) return false;
  const evolutionHttp = /^Evolution respondeu ([1-5]\d{2})\b/.exec(result.error ?? '');
  let reason = 'provider_send_disconnected';
  if (evolutionHttp) {
    reason = evolutionDisconnectReason(result.raw as EvolutionConnectionDetails | null) ?? `evolution_send_http_${evolutionHttp[1]}`;
  } else if (result.error?.startsWith('Número desconectado: a Meta recusou a credencial')) {
    reason = metaErrorReason((result.raw as { error?: unknown } | null)?.error) ?? 'meta_code_190';
  }
  await observeConnection(admin, id, 'disconnected', 'send_failure', startedAt, reason)
    .catch(() => console.error('[wa-connection] Falha ao registrar a recusa do provedor.'));
  return true;
}
