import type { SupabaseClient } from '@supabase/supabase-js';

type ConnectionState = 'connected' | 'disconnected' | 'connecting' | 'unknown';
type ConnectionSource = 'poll' | 'webhook' | 'send_failure' | 'send_blocked' | 'delivery' | 'manual';

/** Record only known provider rejections. A transport timeout can happen after acceptance. */
export function isConfirmedDisconnect(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/timeout|timed?\s*out|ECONNRESET|fetch failed|network error|socket hang up/i.test(detail)) return false;
  return /(?:connection (?:is )?closed|(?:instance|session|whatsapp|number) (?:is )?(?:not (?:connected|open|registered)|disconnected)|número desconectado: (?:reconecte pelo QR|a Meta recusou a credencial do número))/i.test(detail);
}

export async function observeConnection(
  admin: SupabaseClient, connectionId: string, state: ConnectionState, source: ConnectionSource,
  observedAt: string, reason?: string,
  identity?: { phone?: string | null; profileName?: string | null },
): Promise<boolean> {
  const { data, error } = await admin.rpc('wa_observe_connection', {
    p_connection_id: connectionId, p_state: state, p_source: source,
    p_observed_at: observedAt, p_reason: reason ?? null,
    ...(identity ? { p_owner_phone: identity.phone ?? null, p_profile_name: identity.profileName ?? null } : {}),
  });
  if (error) throw new Error('Falha ao registrar a observação da conexão', { cause: error });
  return data === true;
}
