import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProvider, type ConnectionLike } from '@/lib/whatsapp';
import { observeConnection } from './connectionIncidents';

export async function monitorConnections(admin: SupabaseClient, deadlineMs: number) {
  // Check bounded batches. Independent workers claim different numbers in Postgres.
  for (let batch = 0; batch < 5 && Date.now() + 20_000 < deadlineMs; batch++) {
    const { data, error } = await admin.rpc('wa_claim_connection_probes', { p_limit: 8 });
    if (error) throw new Error('Falha ao reservar as conexões para verificação.');
    const connections = (data ?? []) as Array<ConnectionLike & { id: string }>;
    const checked = await Promise.allSettled(connections.map(async connection => {
      const startedAt = new Date().toISOString();
      const provider = getProvider(connection);
      const health = await provider.checkConnectionHealth().catch(() => ({
        state: 'unknown' as const, reason: 'O provedor não respondeu à verificação do número.',
      }));
      // A live QR socket can belong to another handset if a pairing webhook was lost.
      if (health.state === 'connected' && connection.provider === 'evolution') {
        const identity = await provider.getPairingIdentity?.().catch(() => null);
        if (!identity?.phone) {
          await observeConnection(admin, connection.id, 'unknown', 'poll', startedAt, 'identity_unavailable');
          return;
        }
        await observeConnection(admin, connection.id, 'connected', 'poll', startedAt, 'verified_session', identity);
        return;
      }
      await observeConnection(admin, connection.id, health.state, 'poll', startedAt, health.reason);
    }));
    if (checked.some(r => r.status === 'rejected')) console.error('[wa-connection] Falha ao registrar verificação de conexão.');
    if (connections.length < 8) break;
  }
}
