import type { SupabaseClient } from '@supabase/supabase-js';
import type { WaConnectionRow } from './service';

export interface LineIncident {
  connection_id: string;
  opened_at: string;
  reason: string;
}

/** A receipt changes the message status in-place. The timestamp we can present is the send time. */
export interface ConnectionDiagnostics {
  state: 'connected' | 'connecting' | 'disconnected' | 'send_failure' | 'recent_errors' | 'unknown';
  lastCheckedAt: string | null;
  historyAvailable: boolean;
  lastDeliveredMessageAt: string | null;
  incidentOpenedAt: string | null;
  receivedDuringIncidentAt: string | null;
  failedCount: number;
  identityMismatch: boolean;
  pendingCount: number | null;
  reviewCount: number | null;
}

export function connectionDisplayState(
  conn: WaConnectionRow,
  incident: LineIncident | undefined,
  recentSendsFailed: boolean,
  evidenceAvailable: boolean,
  now: number
): ConnectionDiagnostics['state'] {
  if (conn.health_monitor_enabled === false) return 'disconnected';
  if (conn.health_identity_mismatch_at) return 'send_failure';
  if (incident) return incident.reason === 'verification_unavailable' ? 'unknown' : 'send_failure';
  if (!evidenceAvailable || conn.health_check_error) return 'unknown';
  if (conn.status === 'disconnected') return 'disconnected';
  if (conn.status === 'connecting') return 'connecting';
  if (recentSendsFailed) return 'recent_errors';
  const lastEvidence = Math.max(Date.parse(conn.health_state_at || '') || 0, Date.parse(conn.health_checked_at || '') || 0);
  if (conn.status === 'connected' && lastEvidence > 0 && now - lastEvidence <= 10 * 60_000) return 'connected';
  return 'unknown';
}

export async function getLineDiagnostics(
  admin: SupabaseClient, orgId: string, connections: WaConnectionRow[], now = Date.now()
): Promise<ConnectionDiagnostics[]> {
  if (!connections.length) return [];
  const { data, error } = await admin.rpc('wa_line_diagnostics', {
    p_org: orgId, p_connections: connections.map(c => c.id),
  });
  type Evidence = {
    connection_id: string; opened_at: string | null; incident_reason: string | null;
    last_delivered_message_at: string | null; last_inbound_at: string | null; failed_count: number;
    pending_count: number; review_count: number;
  };
  const evidence = new Map(((data ?? []) as Evidence[]).map(row => [row.connection_id, row]));
  return connections.map(conn => {
    const row = evidence.get(conn.id);
    const incident = row?.opened_at ? { connection_id: conn.id, opened_at: row.opened_at, reason: row.incident_reason ?? '' } : undefined;
    return {
      state: connectionDisplayState(conn, incident, Boolean(row?.failed_count), !error && Boolean(row), now),
      lastCheckedAt: conn.health_checked_at ?? null,
      historyAvailable: !error && Boolean(row),
      lastDeliveredMessageAt: row?.last_delivered_message_at ?? null,
      incidentOpenedAt: row?.opened_at ?? null,
      receivedDuringIncidentAt: row?.last_inbound_at ?? null,
      failedCount: row?.failed_count ?? 0,
      identityMismatch: Boolean(conn.health_identity_mismatch_at),
      pendingCount: row?.pending_count ?? null,
      reviewCount: row?.review_count ?? null,
    };
  });
}
