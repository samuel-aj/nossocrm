import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDealContext } from './context';

const org = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
function client(field: unknown, rawDeal: unknown = { id, title: 'Lead', custom_fields: {}, whatsapp_group_id: 'client@g.us' }, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: field, error });
  const from = vi.fn((table: string) => {
    const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: rawDeal }), order: async () => ({ data: table === 'deal_items' ? [] : null }) };
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
