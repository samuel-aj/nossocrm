import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDealContext, buildLeadDataBlock, type ConversationContext } from './context';

const org = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
function client(field: unknown, rawDeal: unknown = { id, title: 'Lead', custom_fields: {}, whatsapp_group_id: 'client@g.us' }, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: field, error });
  const from = vi.fn((table: string) => {
    const q = { select: () => q, eq: () => q, is: () => q, in: () => Promise.resolve({ data: [] }), maybeSingle: async () => ({ data: rawDeal }), order: async () => ({ data: table === 'deal_items' ? [] : null }) };
    return q;
  });
  return { admin: { from, rpc } as unknown as SupabaseClient, rpc };
}
describe('agent deal context group field', () => {
  it.each([{ whatsapp_group_id: '120363012345678901@g.us' }, { whatsapp_group_id: null }, {}])('uses server-derived optional field %j', async field => {
    const { admin, rpc } = client(field);
    const deal = await loadDealContext(admin, org, { dealId: id });
    expect(deal).toMatchObject({ id, title: 'Lead', ...field });
    expect(Object.hasOwn(deal!, 'whatsapp_group_id')).toBe(Object.hasOwn(field, 'whatsapp_group_id'));
    expect(rpc).toHaveBeenCalledWith('deal_whatsapp_group_field', { p_organization_id: org, p_deal_id: id });
  });
  it('fails closed on lookup failure while retaining the existing lead context', async () => {
    const deal = await loadDealContext(client(null, { id, title: 'Lead' }, {}).admin, org, { dealId: id });
    expect(deal?.id).toBe(id);
    expect(Object.hasOwn(deal!, 'whatsapp_group_id')).toBe(false);
  });
  it('leaves absent lead context absent without reading the flag', async () => {
    const { admin, rpc } = client({}, null);
    expect(await loadDealContext(admin, org, { dealId: id })).toBe(null);
    expect(rpc).not.toHaveBeenCalled();
  });
});


describe('agent acquisition source', () => {
  it.each([
    [{ lead_source: 'Indicação', lead_source_initialized: true }, 'Indicação'],
    [{ lead_source: null, lead_source_initialized: true }, null],
    [{ lead_source: null, lead_source_initialized: false }, 'Meta Ads'],
  ])('reads native source without replacing it with a raw UTM: %j', async (source, expected) => {
    const custom_fields = { origem: 'Meta Ads', utm_source: 'Instagram_Feed' };
    const deal = await loadDealContext(client({}, { id, title: 'Lead', ...source, custom_fields }).admin, org, { dealId: id });
    expect(deal?.source).toBe(expected);
    expect(deal?.custom_fields).toEqual(custom_fields);
  });
  it('does not infer a source from ambiguous UTM or contact data', async () => {
    const deal = await loadDealContext(client({}, { id, title: 'Lead', source: 'WEBSITE', custom_fields: { utm_source: 'ig' } }).admin, org, { dealId: id });
    expect(deal?.source).toBeNull();
  });
});

it('does not tell the agent a stale legacy source after native source was cleared', async () => {
  const deal = await loadDealContext(client({}, { id, title: 'Lead', lead_source: null, lead_source_initialized: true, custom_fields: { origem: 'Meta Ads', utm_source: 'Instagram_Feed' } }).admin, org, { dealId: id });
  const block = buildLeadDataBlock({ deal } as ConversationContext);
  expect(block).toContain('Origem: Não informado');
  expect(block).toContain('utm_source: Instagram_Feed');
  expect(block).not.toContain('Meta Ads');
});
