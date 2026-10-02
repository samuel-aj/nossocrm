import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverWebhook } from './outbound';

const org = '11111111-1111-4111-8111-111111111111';
const dealId = '22222222-2222-4222-8222-222222222222';
const snapshot = { deal: { id: dealId, whatsapp_group_id: 'stale@g.us' }, 'deal.whatsapp_group_id': 'stale@g.us', nested: [{ whatsapp_group_id: 'stale@g.us', value: 'keep' }] };
function setup(field: unknown, payload: Record<string, unknown> = snapshot) {
  const rpc = vi.fn().mockResolvedValue({ data: field, error: null });
  const rows: Record<string, unknown> = {
    webhook_deliveries: { id: 'delivery', organization_id: org, endpoint_id: 'endpoint', event_id: 'event', retry_count: 1 },
    webhook_events_out: { id: 'event', organization_id: org, payload },
    integration_outbound_endpoints: { id: 'endpoint', url: 'https://example.invalid/hook', secret: 'secret', active: true },
  };
  const admin = { rpc, from: (table: string) => {
    const q = { select: () => q, eq: () => q, update: () => q, single: async () => ({ data: rows[table], error: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) };
    return q;
  } } as unknown as SupabaseClient;
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return { admin, fetchMock, rpc };
}
afterEach(() => vi.unstubAllGlobals());
describe('persisted outgoing event retry', () => {
  it.each([{ whatsapp_group_id: '120363012345678901@g.us' }, { whatsapp_group_id: null }, {}])('refreshes snapshot at delivery with %j', async field => {
    const { admin, fetchMock, rpc } = setup(field);
    expect(await deliverWebhook(admin, 'delivery')).toEqual({ deliveryId: 'delivery', success: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ deal: { id: dealId, ...field }, nested: snapshot.nested });
    expect(rpc).toHaveBeenCalledWith('deal_whatsapp_group_field', { p_organization_id: org, p_deal_id: dealId });
    expect(snapshot.deal.whatsapp_group_id).toBe('stale@g.us');
  });
  it('omits a stale snapshot value if authoritative lookup fails', async () => {
    const { admin, fetchMock, rpc } = setup({});
    rpc.mockResolvedValue({ data: null, error: {} });
    expect((await deliverWebhook(admin, 'delivery')).success).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).deal).toEqual({ id: dealId });
  });
  it.each([
    { label: 'enabled linked', field: { whatsapp_group_id: '120363012345678901@g.us' }, error: null },
    { label: 'enabled unlinked', field: { whatsapp_group_id: null }, error: null },
    { label: 'disabled', field: {}, error: null },
    { label: 'failed lookup', field: {}, error: { message: 'unavailable' } },
  ])('preserves SQL event custom fields on retry ($label)', async ({ field, error }) => {
    const customFields = { whatsapp_group_id: 'stale@g.us', nested: [{ 'deal.whatsapp_group_id': 'stale@g.us' }] };
    const storedPayload = { ...snapshot, deal: { ...snapshot.deal, custom_fields: customFields }, metadata: { whatsapp_group_id: 'stale@g.us' } };
    const before = JSON.stringify(storedPayload);
    const { admin, fetchMock, rpc } = setup(field, storedPayload);
    rpc.mockResolvedValue({ data: field, error });
    expect(await deliverWebhook(admin, 'delivery')).toEqual({ deliveryId: 'delivery', success: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      deal: { id: dealId, custom_fields: customFields, ...field },
      nested: snapshot.nested,
      metadata: storedPayload.metadata,
    });
    expect(JSON.stringify(storedPayload)).toBe(before);
  });
});
