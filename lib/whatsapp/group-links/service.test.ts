import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDealWhatsappGroupField, isGroupExternalId } from './service';
import { getGroupLinksEnabled } from './settings';

const org = '11111111-1111-4111-8111-111111111111';
const deal = '22222222-2222-4222-8222-222222222222';
function client(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { admin: { rpc } as unknown as SupabaseClient, rpc };
}
describe('trusted group field', () => {
  it.each([{}, { whatsapp_group_id: null }, { whatsapp_group_id: '120363012345678901@g.us' }])('returns current atomic RPC value %j', async data => {
    const { admin, rpc } = client(data);
    expect(await getDealWhatsappGroupField(admin, org, deal)).toEqual(data);
    expect(rpc).toHaveBeenCalledWith('deal_whatsapp_group_field', { p_organization_id: org, p_deal_id: deal });
  });
  it('fails closed on database errors', async () => {
    await expect(getDealWhatsappGroupField(client(null, { message: 'private database detail' }).admin, org, deal)).rejects.toThrow('Não foi possível');
  });
  it.each([null, { whatsapp_group_id: '123' }, { whatsapp_group_id: '@g.us' }, { whatsapp_group_id: '123@s.whatsapp.net' }, { secret: 'unexpected' }])('rejects malformed RPC data %j', async data => {
    await expect(getDealWhatsappGroupField(client(data).admin, org, deal)).rejects.toThrow();
  });
});
describe('group identity', () => {
  it.each(['120363012345678901@g.us', '55119999-1234@g.us'])('preserves %s', jid => expect(isGroupExternalId(jid)).toBe(true));
  it.each(['', '@g.us', ' 123@g.us', '123@g.us ', '123@g.us\n', '123@s.whatsapp.net', '123', 'a@b@g.us'])('rejects %s', jid => expect(isGroupExternalId(jid)).toBe(false));
});
describe('setting', () => {
  it.each([true, false, null])('reads exact true only (%j)', async enabled => {
    const q = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: enabled === null ? null : { wa_group_links_enabled: enabled }, error: null }) };
    q.select.mockReturnValue(q); q.eq.mockReturnValue(q);
    expect(await getGroupLinksEnabled({ from: () => q } as unknown as SupabaseClient, org)).toBe(enabled === true);
    expect(q.eq).toHaveBeenCalledWith('organization_id', org);
  });
  it('does not silently hide database errors', async () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: {} }) };
    await expect(getGroupLinksEnabled({ from: () => q } as unknown as SupabaseClient, org)).rejects.toThrow();
  });
});
