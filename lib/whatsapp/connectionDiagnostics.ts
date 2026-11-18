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
  lastIncident: {
    openedAt: string;
    resolvedAt: string | null;
    detectedBy: string;
    observation: string;
    observedBy: string;
    observedAt: string;
  } | null;
  receivedDuringIncidentAt: string | null;
  failedCount: number;
  identityMismatch: boolean;
  metaMessagingLimited: boolean;
  pendingCount: number | null;
  reviewCount: number | null;
}

const observationSources: Record<string, string> = {
  send_blocked: 'Controle de envio do CRM',
  send_failure: 'Resposta do provedor ao envio',
  webhook: 'Evento recebido do provedor',
  poll: 'Verificação automática do CRM',
  manual: 'Operação manual no CRM',
  delivery: 'Recibo de entrega do WhatsApp',
};

const observations: Record<string, string> = {
  crm_send_blocked: 'O CRM interrompeu o envio antes de chamar o provedor porque a linha constava como desconectada.',
  provider_send_disconnected: 'O provedor recusou o envio por desconexão.',
  number_changed: 'A sessão foi pareada com outro número.',
  identity_unavailable: 'O provedor não confirmou qual telefone estava pareado.',
  verification_unavailable: 'As verificações sucessivas não confirmaram o estado da linha.',
  webhook_undated: 'O provedor enviou uma atualização sem horário de origem.',
  webhook_unknown_state: 'O estado informado no evento não foi reconhecido.',
  evolution_session_closed: 'A Evolution informou que a sessão estava fechada.',
  evolution_state_close: 'A Evolution informou que a sessão estava fechada.',
  evolution_state_connecting: 'A Evolution informou que a sessão estava conectando.',
  evolution_state_unknown: 'A Evolution não confirmou o estado da sessão.',
  evolution_session_check_unavailable: 'O teste de disponibilidade da sessão Evolution foi inconclusivo.',
  meta_health_blocked: 'A Meta informou que os envios estavam bloqueados.',
  meta_health_limited: 'A Meta informou que a disponibilidade para envios estava limitada.',
  meta_health_unknown: 'A Meta não confirmou a disponibilidade para enviar mensagens.',
  meta_missing_credentials: 'As credenciais do número estavam incompletas no CRM.',
  probe_timeout: 'A consulta ao provedor excedeu o tempo de espera.',
  probe_transport_error: 'A consulta ao provedor falhou antes de obter uma resposta.',
};

export function describeObservation(reason: string | null, source: string | null): string {
  if (reason && Object.hasOwn(observations, reason)) return observations[reason];
  const parts = reason?.match(/^(webhook_undated_)?evolution_disconnect_(\d{1,6})$/);
  if (parts) return parts[1]
    ? `A Evolution informou o código de desconexão ${parts[2]} em um evento sem horário de origem.`
    : `A Evolution informou o código de desconexão ${parts[2]}.`;
  const meta = reason?.match(/^meta_(query_)?code_(\d{1,8})(?:_sub_(\d{1,10}))?$/);
  if (meta) {
    const code = meta[2] + (meta[3] ? ` (subcódigo ${meta[3]})` : '');
    if (meta[1]) return `A consulta à Meta sobre o estado deste número retornou o código ${code}.`;
    if (meta[2] === '138024' || meta[2] === '138025') {
      return `A Meta informou uma restrição de chamadas via SIP (código ${code}). Esse aviso, por si só, não indica falha no envio de mensagens.`;
    }
    return `A Meta retornou o código ${code}.`;
  }
  const http = reason?.match(/^(evolution_send|evolution_socket|evolution|meta_query|meta)_http_(\d{3})$/);
  if (http?.[1] === 'evolution_socket') return `O teste de disponibilidade da sessão Evolution retornou HTTP ${http[2]}.`;
  if (http) return http[1] === 'evolution_send'
    ? `A Evolution recusou o envio e retornou HTTP ${http[2]}.`
    : `A consulta à ${http[1] === 'evolution' ? 'Evolution' : 'Meta'} retornou HTTP ${http[2]}.`;
  if (source === 'send_blocked') return observations.crm_send_blocked;
  if (source === 'send_failure') return observations.provider_send_disconnected;
  if (source === 'webhook' && reason === 'disconnected') return 'O provedor informou que a sessão desconectou. O evento veio sem código de motivo.';
  if (source === 'webhook' && reason === 'connecting') return 'O provedor informou que a sessão estava tentando conectar.';
  return 'O registro não permite identificar a causa da interrupção.';
}

export function sourceLabel(source: string | null) {
  return source && Object.hasOwn(observationSources, source) ? observationSources[source] : 'Origem não informada';
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
    last_incident_opened_at: string | null; last_incident_resolved_at: string | null;
    last_incident_source: string | null; diagnostic_reason: string | null; diagnostic_source: string | null; diagnostic_at: string | null;
  };
  const evidence = new Map(((data ?? []) as Evidence[]).map(row => [row.connection_id, row]));
  return connections.map(conn => {
    const row = evidence.get(conn.id);
    const incident = row?.opened_at ? { connection_id: conn.id, opened_at: row.opened_at, reason: row.incident_reason ?? '' } : undefined;
    const state = connectionDisplayState(conn, incident, Boolean(row?.failed_count), !error && Boolean(row), now);
    return {
      state,
      metaMessagingLimited: state === 'connected' && conn.provider === 'meta_cloud' && conn.health_probe_reason === 'meta_messaging_limited',
      lastCheckedAt: conn.health_checked_at ?? null,
      historyAvailable: !error && Boolean(row),
      lastDeliveredMessageAt: row?.last_delivered_message_at ?? null,
      incidentOpenedAt: row?.opened_at ?? null,
      lastIncident: row?.last_incident_opened_at ? {
        openedAt: row.last_incident_opened_at, resolvedAt: row.last_incident_resolved_at,
        detectedBy: sourceLabel(row.last_incident_source),
        observation: describeObservation(row.diagnostic_reason, row.diagnostic_source),
        observedBy: sourceLabel(row.diagnostic_source),
        observedAt: row.diagnostic_at ?? row.last_incident_opened_at,
      } : null,
      receivedDuringIncidentAt: row?.last_inbound_at ?? null,
      failedCount: row?.failed_count ?? 0,
      identityMismatch: Boolean(conn.health_identity_mismatch_at),
      pendingCount: row?.pending_count ?? null,
      reviewCount: row?.review_count ?? null,
    };
  });
}
