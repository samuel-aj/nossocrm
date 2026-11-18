import type { SupabaseClient } from '@supabase/supabase-js';
import { isConfirmedDisconnect, observeConnection } from './connectionIncidents';
import type { SendResult } from './providers/types';

export async function reportBlockedSend(admin: SupabaseClient, id: string) {
  await observeConnection(admin, id, 'disconnected', 'send_blocked', new Date().toISOString(), 'Envio bloqueado pelo estado da conexão.')
    .catch(() => console.error('[wa-connection] Falha ao registrar bloqueio local de envio.'));
}

/** Call only with a provider response. A network exception or an accepted id must never qualify for retry. */
export async function reportRejectedSend(admin: SupabaseClient, id: string, result: SendResult, startedAt: string) {
  if (result.ok || result.providerMessageId || !isConfirmedDisconnect(result.error)) return false;
  await observeConnection(admin, id, 'disconnected', 'send_failure', startedAt, 'O provedor recusou o envio por desconexão.')
    .catch(() => console.error('[wa-connection] Falha ao registrar a recusa do provedor.'));
  return true;
}
