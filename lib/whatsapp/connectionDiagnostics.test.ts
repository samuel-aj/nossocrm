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
});
