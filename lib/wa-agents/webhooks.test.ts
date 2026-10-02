import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchAgentEvent, postWebhook } from './webhooks';
import type { ConversationContext } from './context';
import type { AgentRow } from './types';

const org = '11111111-1111-4111-8111-111111111111';
const dealId = '22222222-2222-4222-8222-222222222222';
const jid = '120363012345678901@g.us';
const snapshot = { deal: { id: dealId, whatsapp_group_id: 'stale@g.us' }, contact: { name: 'Maria' } };
const url = 'https://8.8.8.8/webhook';
function setup(fields: unknown[]) {
  const rpc = vi.fn();
  for (const data of fields) rpc.mockResolvedValueOnce({ data, error: null });
  const admin = { rpc } as unknown as SupabaseClient;
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return { admin, rpc, fetchMock };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('immediate agent/action/bot webhook transport', () => {
  it.each([{ whatsapp_group_id: jid }, { whatsapp_group_id: null }, {}])('captures fresh default outgoing body %j', async field => {
    const { admin, fetchMock } = setup([field]);
    expect((await postWebhook({ admin, organizationId: org, url, event: 'bot_webhook', payload: snapshot })).ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ deal: { id: dealId, ...field }, contact: { name: 'Maria' } });
  });
  it('refreshes gating on the short transport retry, after the flag switches off', async () => {
    vi.useFakeTimers();
    const { admin, fetchMock, rpc } = setup([{ whatsapp_group_id: jid }, {}]);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const result = postWebhook({ admin, organizationId: org, url, event: 'outcome_action', payload: snapshot, body_template: '{"group":"{{deal.whatsapp_group_id}}","name":"{{contact.name}}"}' });
    await vi.runAllTimersAsync();
    expect((await result).ok).toBe(true);
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))).toEqual([{ group: jid, name: 'Maria' }, { name: 'Maria' }]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('does not send stale values on a failed authoritative lookup', async () => {
    const { admin, fetchMock, rpc } = setup([]);
    rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    await postWebhook({ admin, organizationId: org, url, event: 'custom_action', payload: snapshot });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ deal: { id: dealId }, contact: { name: 'Maria' } });
  });
  it('refreshes each agent hook individually when the flag changes between hooks', async () => {
    const { admin, fetchMock } = setup([{ whatsapp_group_id: jid }, {}]);
    const agent = { id: 'agent', name: 'Agent', webhooks: [{ id: 'one', url, event: 'started' }, { id: 'two', url, event: 'started' }] } as unknown as AgentRow;
    const ctx = { conversation: { id: 'conversation', organization_id: org }, deal: snapshot.deal, contact: snapshot.contact } as unknown as ConversationContext;
    const results = await dispatchAgentEvent(admin, { agent, event: 'started', ctx });
    expect(results).toHaveLength(2);
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).deal)).toEqual([{ id: dealId, whatsapp_group_id: jid }, { id: dealId }]);
  });
});
