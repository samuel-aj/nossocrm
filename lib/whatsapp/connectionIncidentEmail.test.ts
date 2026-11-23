import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchConnectionIncidentEmails } from './connectionIncidentEmail';
import { isConfirmedDisconnect } from './connectionIncidents';
import { connectionEventTime } from '../../supabase/functions/whatsapp-webhook/connection-event-time';

const job = { id: 'notice', lease_token: 'lease', mail_provider: 'resend', phase: 'opened', recipient_email: 'pessoa@example.invalid',
  line_label: 'Linha A', occurred_at: '2026-01-02T13:00:00Z', reason: 'provider_rejected' };
const rpc = vi.fn();
const admin = { rpc } as unknown as Parameters<typeof dispatchConnectionIncidentEmails>[0];
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY','test-only');
  vi.stubEnv('WA_CONNECTION_ALERT_EMAIL_FROM','CRM <crm@example.invalid>');
  vi.stubEnv('WA_CONNECTION_HOSTINGER_MAIL_TOKEN','');
  vi.stubEnv('WA_CONNECTION_HOSTINGER_MAILBOX_ID','');
  vi.stubEnv('WA_CONNECTION_ALERT_EMAIL_START_AT','');
  rpc.mockReset().mockImplementation(async method=>method==='wa_claim_connection_email_batch'?{data:[job]}:{data:true});
});

describe('Hostinger Mail API', () => {
  const startAt = '2026-11-18T18:00:00.000Z';
  beforeEach(() => {
    vi.stubEnv('WA_CONNECTION_HOSTINGER_MAIL_TOKEN', 'test-mailbox-token');
    vi.stubEnv('WA_CONNECTION_HOSTINGER_MAILBOX_ID', 'ACexample');
    vi.stubEnv('WA_CONNECTION_ALERT_EMAIL_START_AT', startAt);
    rpc.mockImplementation(async method => method === 'wa_claim_connection_email_batch'
      ? { data: [{ ...job, mail_provider: 'hostinger' }] } : { data: true });
  });
  it('claims with an activation cutoff, records intent, then submits the mailbox API payload and acknowledges 204', async () => {
    const send = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', send);
    expect(await dispatchConnectionIncidentEmails(admin)).toEqual({ configured: true, sent: 1, deferred: 0 });
    expect(rpc.mock.calls[0]).toEqual(['wa_claim_connection_email_batch', { p_providers: ['hostinger','resend'], p_hostinger_start_at: startAt, p_limit: 12 }]);
    expect(rpc.mock.calls[1]).toEqual(['wa_begin_hostinger_connection_email', { p_id: 'notice', p_lease_token: 'lease' }]);
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(send.mock.invocationCallOrder[0]);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe('https://api.mail.hostinger.com/api/v1/mailboxes/ACexample/send');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer test-mailbox-token' } });
    expect(JSON.parse(init.body)).toEqual({ to: [job.recipient_email], displayName: 'CRM', subject: 'Falha na conexão do WhatsApp · Linha A', text: expect.stringContaining('Horário de Brasília') });
    expect(rpc).toHaveBeenLastCalledWith('wa_finish_connection_email',{p_id:'notice',p_lease_token:'lease',p_error:null});
  });
  it.each([[200,'hostinger_unconfirmed'],[401,'hostinger_http_401'],[403,'hostinger_http_403'],[422,'hostinger_http_422'],[429,'hostinger_http_429'],[500,'hostinger_unconfirmed'],[502,'hostinger_unconfirmed'],[504,'hostinger_unconfirmed']])(
    'classifies HTTP %d without claiming success or falling back to Resend', async (status, error) => {
      const send = vi.fn().mockResolvedValue({ status });
      vi.stubGlobal('fetch', send);
      expect((await dispatchConnectionIncidentEmails(admin)).deferred).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenLastCalledWith('wa_finish_connection_email', { p_id: 'notice', p_lease_token: 'lease', p_error: error });
    });
  it('preserves an ambiguous outcome on transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await dispatchConnectionIncidentEmails(admin);
    expect(rpc).toHaveBeenLastCalledWith('wa_finish_connection_email', { p_id:'notice',p_lease_token:'lease',p_error:'hostinger_unconfirmed' });
  });
  it('skips network I/O if the durable lease cannot be armed', async () => {
    rpc.mockResolvedValueOnce({data:[{...job,mail_provider:'hostinger'}]}).mockResolvedValueOnce({data:false});
    vi.stubGlobal('fetch',vi.fn());
    expect((await dispatchConnectionIncidentEmails(admin)).deferred).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each(['', '2026-11-18', 'not-a-date'])('leaves Hostinger inactive without a valid UTC activation time: %s', async start => {
    vi.stubEnv('RESEND_API_KEY','');
    vi.stubEnv('WA_CONNECTION_ALERT_EMAIL_START_AT',start);
    expect((await dispatchConnectionIncidentEmails(admin)).configured).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
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
