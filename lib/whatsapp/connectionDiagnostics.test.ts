import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WaConnectionRow } from './service';
import { connectionDisplayState, getLineDiagnostics, type LineIncident } from './connectionDiagnostics';

const now = Date.parse('2026-11-18T12:00:00Z');
const row = { status: 'connected', health_checked_at: '2026-11-18T11:59:58Z' } as WaConnectionRow;
const outage: LineIncident = { connection_id: 'number-a', reason: 'number_disconnected', opened_at: row.health_checked_at! };

describe('status of a WhatsApp number', () => {
  it('shows the active incident when the AI stopped before recording any outgoing message', () => {
    expect(connectionDisplayState(row, outage, false, true, now)).toBe('send_failure');
    expect(connectionDisplayState(row, undefined, false, true, now)).toBe('connected');
  });
  it('distinguishes a failed check from a confirmed sending failure', () => {
    expect(connectionDisplayState(row, { ...outage, reason: 'verification_unavailable' }, false, true, now)).toBe('unknown');
    expect(connectionDisplayState({ ...row, health_check_error: 'network' }, undefined, false, true, now)).toBe('unknown');
    expect(connectionDisplayState(row, undefined, true, true, now)).toBe('recent_errors');
    expect(connectionDisplayState({ ...row, health_identity_mismatch_at: outage.opened_at }, undefined, false, true, now)).toBe('send_failure');
  });
  it('does not show green for a stale record, unavailable evidence or an intentional disconnect', () => {
    expect(connectionDisplayState(row, undefined, false, true, now + 11 * 60_000)).toBe('unknown');
    expect(connectionDisplayState(row, undefined, false, false, now)).toBe('unknown');
    expect(connectionDisplayState({ ...row, health_monitor_enabled: false }, outage, true, true, now)).toBe('disconnected');
  });
  it('combines counters and receipts from the same visible line and preserves unknown totals on failure', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [{ connection_id: 'b', pending_count: 3, review_count: 1,
      opened_at: outage.opened_at, incident_reason: outage.reason, failed_count: 0, last_delivered_message_at: 'old' }],
      error: null }).mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    const admin = { rpc } as unknown as SupabaseClient;
    const lines = [{ ...row, id: 'a' }, { ...row, id: 'b' }];
    const [a, b] = await getLineDiagnostics(admin, 'org', lines, now);
    expect(rpc).toHaveBeenCalledWith('wa_line_diagnostics', { p_org: 'org', p_connections: ['a', 'b'] });
    expect(a).toMatchObject({ pendingCount: null, reviewCount: null, state: 'unknown' });
    expect(b).toMatchObject({ pendingCount: 3, reviewCount: 1, state: 'send_failure', lastDeliveredMessageAt: 'old' });
    expect((await getLineDiagnostics(admin, 'org', lines, now))[1].pendingCount).toBeNull();
  });
  it.each([
    ['crm_send_blocked', 'send_blocked', /antes de chamar o provedor/],
    ['meta_code_190_sub_463', 'send_failure', /código 190 \(subcódigo 463\)/],
    ['meta_code_138024', 'poll', /chamadas via SIP \(código 138024\)/],
    ['meta_code_138025', 'poll', /chamadas via SIP \(código 138025\)/],
    ['meta_query_code_100_sub_33', 'poll', /consulta à Meta.*código 100 \(subcódigo 33\)/],
    ['meta_query_http_503', 'poll', /consulta à Meta retornou HTTP 503/],
    ['evolution_socket_http_429', 'poll', /teste de disponibilidade da sessão Evolution retornou HTTP 429/],
    ['evolution_disconnect_401', 'webhook', /desconexão 401/],
    ['webhook_undated_evolution_disconnect_440', 'webhook', /440 em um evento sem horário/],
    ['disconnected', 'webhook', /evento veio sem código de motivo/],
    ['evolution_http_503', 'poll', /consulta à Evolution retornou HTTP 503/],
    ['unknown_text_that_might_contain_customer_data', 'webhook', /não permite identificar a causa/],
  ] as const)('describes a closed incident without changing the line state: %s', async (reason, source, expected) => {
    const opened = '2026-11-18T09:00:00Z';
    const resolved = '2026-11-18T10:00:00Z';
    const diagnostic = '2026-11-18T09:05:00Z';
    const admin = { rpc: vi.fn().mockResolvedValue({ data: [{
      connection_id: 'line', opened_at: null, failed_count: 0, last_incident_opened_at: opened,
      last_incident_resolved_at: resolved, last_incident_source: 'send_blocked', diagnostic_reason: reason,
      diagnostic_source: source, diagnostic_at: diagnostic,
    }], error: null }) } as unknown as SupabaseClient;
    const [result] = await getLineDiagnostics(admin, 'org', [{ ...row, id: 'line' }], now);
    expect(result).toMatchObject({
      state: 'connected', incidentOpenedAt: null,
      lastIncident: { openedAt: opened, resolvedAt: resolved, observedAt: diagnostic, detectedBy: 'Controle de envio do CRM',
        observation: expect.stringMatching(expected) },
    });
  });
  it.each([
    ['meta_cloud', 'connected', 'meta_messaging_limited', true],
    ['meta_cloud', 'disconnected', 'meta_messaging_limited', false],
    ['meta_cloud', 'connected', 'meta_code_138024', false],
    ['meta_cloud', 'connected', 'not_a_public_reason', false],
    ['evolution', 'connected', 'meta_messaging_limited', false],
  ] as const)('exposes only a confirmed messaging restriction for %s/%s/%s', async (provider, status, reason, limited) => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: [{ connection_id: 'line' }], error: null }) } as unknown as SupabaseClient;
    const [health] = await getLineDiagnostics(admin, 'org', [
      { ...row, id: 'line', provider, status, health_probe_reason: reason },
    ], now);
    expect(health).toMatchObject({ state: status, metaMessagingLimited: limited });
    expect(health).not.toHaveProperty('health_probe_reason');
  });
});
