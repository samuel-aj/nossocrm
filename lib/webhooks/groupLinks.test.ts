import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareGroupLinkWebhookPayload } from './groupLinks';

const org = '11111111-1111-4111-8111-111111111111';
const dealId = '22222222-2222-4222-8222-222222222222';
const jid = '120363012345678901@g.us';
const payload = { deal: { id: dealId, title: 'Lead', whatsapp_group_id: 'stale@g.us' }, contact: { name: 'Maria' } };
function client(field: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: field, error });
  return { admin: { rpc } as unknown as SupabaseClient, rpc };
}
describe('group link webhook delivery contract', () => {
  it.each([{ whatsapp_group_id: jid }, { whatsapp_group_id: null }, {}])('refreshes stale default deal with %j without mutating snapshot', async field => {
    const { admin, rpc } = client(field);
    expect(await prepareGroupLinkWebhookPayload(admin, org, payload)).toEqual({ deal: { id: dealId, title: 'Lead', ...field }, contact: { name: 'Maria' } });
    expect(rpc).toHaveBeenCalledWith('deal_whatsapp_group_field', { p_organization_id: org, p_deal_id: dealId });
    expect(payload.deal.whatsapp_group_id).toBe('stale@g.us');
  });
  it.each([
    ['{"target":"{{deal.whatsapp_group_id}}","name":"{{contact.name}}"}', { name: 'Maria' }],
    ['{"target":"prefix {{ deal.whatsapp_group_id }}!","name":"{{contact.name}}"}', { name: 'Maria' }],
    ['{"nested":{"group":{{deal.whatsapp_group_id}},"name":"{{contact.name}}"},"list":["{{deal.whatsapp_group_id}}", "prefix {{deal.whatsapp_group_id}}", "{{contact.name}}"]}', { nested: { name: 'Maria' }, list: ['Maria'] }],
    ['{"lead":{{deal}},"text":"{{deal}}","items":{{deal.items}}}', { lead: { id: dealId, title: 'Lead' }, text: JSON.stringify({ id: dealId, title: 'Lead' }), items: null }],
    ['{"{{deal.whatsapp_group_id}}":"value","name":"{{contact.name}}"}', { name: 'Maria' }],
  ])('omits disabled dependencies before generic rendering: %s', async (template, expected) => {
    expect(await prepareGroupLinkWebhookPayload(client({}).admin, org, payload, template)).toEqual(expected);
  });
  it('preserves unrelated template semantics', async () => {
    expect(await prepareGroupLinkWebhookPayload(client({}).admin, org, payload, '{"name":"{{contact.name}}","missing":"{{missing}}","text":"Hi {{missing}}!"}')).toEqual({ name: 'Maria', missing: null, text: 'Hi !' });
  });
  it('preserves typed raw variables and escaped strings when pruning one group property', async () => {
    const p = { ...payload, deal: { ...payload.deal, items: [{ name: 'Item' }] }, count: 3, active: true };
    const template = '{"group":{{deal.whatsapp_group_id}},"items":{{deal.items}},"count":{{count}},"active":{{active}},"escaped":"say \\"{{contact.name}}\\""}';
    expect(await prepareGroupLinkWebhookPayload(client({}).admin, org, p, template)).toEqual({ items: [{ name: 'Item' }], count: 3, active: true, escaped: 'say "Maria"' });
  });
  it('scrubs raw text and invalid JSON fallback without leaking a stale ID', async () => {
    expect(await prepareGroupLinkWebhookPayload(client({}).admin, org, payload, 'Group {{deal.whatsapp_group_id}} for {{contact.name}}: {{deal}}')).toBe(`Group  for Maria: ${JSON.stringify({ id: dealId, title: 'Lead' })}`);
    expect(await prepareGroupLinkWebhookPayload(client({}).admin, org, payload, '{"group":{{deal.whatsapp_group_id}}, broken')).toBe('{"group":, broken');
  });
  it('removes legacy keys recursively in stored snapshots', async () => {
    const p = { ...payload, nested: { whatsapp_group_id: jid, entries: [{ whatsapp_group_id: jid, name: 'safe' }] } };
    expect(await prepareGroupLinkWebhookPayload(client({}).admin, org, p)).toEqual({ deal: { id: dealId, title: 'Lead' }, contact: { name: 'Maria' }, nested: { entries: [{ name: 'safe' }] } });
  });
  it('reactivation resolves current principal and supports null templates', async () => {
    const { admin, rpc } = client({});
    rpc.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({ data: { whatsapp_group_id: jid }, error: null });
    expect(await prepareGroupLinkWebhookPayload(admin, org, payload, '{"group":"{{deal.whatsapp_group_id}}"}')).toEqual({});
    expect(await prepareGroupLinkWebhookPayload(admin, org, payload, '{"group":"{{deal.whatsapp_group_id}}"}')).toEqual({ group: jid });
    expect(await prepareGroupLinkWebhookPayload(client({ whatsapp_group_id: null }).admin, org, payload, '{"group":"{{deal.whatsapp_group_id}}"}')).toEqual({ group: null });
  });
  it('fails closed on flag lookup failure', async () => {
    expect(await prepareGroupLinkWebhookPayload(client(null, {}).admin, org, payload, '{"group":"{{deal.whatsapp_group_id}}","name":"{{contact.name}}"}')).toEqual({ name: 'Maria' });
  });
  it.each([null, undefined])('does not invent an empty lead (%s)', async deal => {
    const { admin, rpc } = client({ whatsapp_group_id: jid });
    const p = deal === undefined ? { contact: { name: 'Maria' } } : { deal, contact: { name: 'Maria' } };
    expect(await prepareGroupLinkWebhookPayload(admin, org, p)).toEqual(p);
    expect(rpc).not.toHaveBeenCalled();
  });
});
