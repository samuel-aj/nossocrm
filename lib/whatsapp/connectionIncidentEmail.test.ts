import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchConnectionIncidentEmails } from './connectionIncidentEmail';
import { isConfirmedDisconnect } from './connectionIncidents';
import { connectionEventTime } from '../../supabase/functions/whatsapp-webhook/connection-event-time';

const job = { id: 'notice', lease_token: 'lease', phase: 'opened', recipient_email: 'pessoa@example.invalid',
  line_label: 'Linha A', occurred_at: '2026-01-02T13:00:00Z', reason: 'provider_rejected' };
const rpc = vi.fn();
const admin = { rpc } as unknown as Parameters<typeof dispatchConnectionIncidentEmails>[0];
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY','test-only');
  vi.stubEnv('WA_CONNECTION_ALERT_EMAIL_FROM','CRM <crm@example.invalid>');
  rpc.mockReset().mockImplementation(async method=>method==='wa_claim_connection_emails'?{data:[job]}:{data:true});
});
afterEach(()=>{vi.unstubAllEnvs(); vi.unstubAllGlobals();});
describe('connection alert email',()=>{
  it('uses a stable idempotency key and acknowledges the lease after provider success',async()=>{
    const send=vi.fn().mockResolvedValue({ok:true});
    vi.stubGlobal('fetch',send);
    expect(await dispatchConnectionIncidentEmails(admin)).toEqual({configured:true,sent:1,deferred:0});
    expect(send).toHaveBeenCalledWith('https://api.resend.com/emails',expect.objectContaining({
      headers:expect.objectContaining({'Idempotency-Key':'wa-connection/notice'}),
    }));
    expect(rpc).toHaveBeenLastCalledWith('wa_finish_connection_email',{p_id:'notice',p_lease_token:'lease',p_error:null});
  });
  it('leaves failed and ambiguous sends retryable',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('timeout')));
    expect((await dispatchConnectionIncidentEmails(admin)).deferred).toBe(1);
    expect(rpc).toHaveBeenLastCalledWith('wa_finish_connection_email',{p_id:'notice',p_lease_token:'lease',p_error:'email_transport_unconfirmed'});
  });
  it('does not claim or discard notices without a mail sender',async()=>{
    vi.stubEnv('WA_CONNECTION_ALERT_EMAIL_FROM','');
    vi.stubGlobal('fetch',vi.fn());
    expect((await dispatchConnectionIncidentEmails(admin)).configured).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
it('accepts an explicit disconnect, never an ambiguous transport error or the cached gate',()=>{
  expect(isConfirmedDisconnect('Evolution respondeu 400: Connection Closed')).toBe(true);
  expect(isConfirmedDisconnect('WhatsApp is not registered')).toBe(true);
  expect(isConfirmedDisconnect(new Error('socket hang up'))).toBe(false);
  expect(isConfirmedDisconnect('network error while checking if instance is disconnected')).toBe(false);
  expect(isConfirmedDisconnect('número desconectado')).toBe(false);
});
it('uses source time with timezone and rejects undated or untrustworthy webhooks',()=>{
  const now=Date.parse('2026-11-18T03:00:10Z');
  expect(connectionEventTime('2026-11-18T00:00:00-03:00',now)).toBe('2026-11-18T03:00:00.000Z');
  expect(connectionEventTime((now-10000)/1000,now)).toBe('2026-11-18T03:00:00.000Z');
  expect(connectionEventTime('2026-11-18T00:00:00',now)).toBeNull();
  expect(connectionEventTime('2030-01-01T00:00:00Z',now)).toBeNull();
  expect(connectionEventTime({},now)).toBeNull();
});
