import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchPendingPush } from './pushDispatch';
import { loadAuthorizedPushMessage } from './pushEligibility';
import { deliverWebPush } from './webPush';

vi.mock('./pushEligibility', () => ({ loadAuthorizedPushMessage: vi.fn() }));
vi.mock('./webPush', () => ({ deliverWebPush: vi.fn() }));
const row = { id: 'entrega', lease_token: 'lease', event_id: '1', message_id: 'm', organization_id: 'org', user_id: 'u', subscription_id: 's' };
const config = { subject: 'mailto:teste@example.test', publicKey: '', privateKey: '' };
const device = { endpoint: 'endpoint falso', p256dh: 'chave', auth: 'auth' };
function database(subscription: object | null = device, lease: object | null = { id: row.id }) {
  const rpc = vi.fn(async (name: string, _args?: object) => ({ data: name === 'claim_crm_push_deliveries' ? [row] : true, error: null }));
  const filters: Array<[string, string, unknown]> = [];
  const from = vi.fn((table: string) => {
    const query = { select: () => query, eq: (field: string, value: string) => { filters.push([table, field, value]); return query; },
      gt: (field: string, value: string) => { filters.push([table, field, value]); return query; },
      maybeSingle: async () => ({ data: table === 'crm_push_subscriptions' ? subscription : lease, error: null }) };
    return query;
  });
  return { admin: { from, rpc } as unknown as SupabaseClient, rpc, filters, from };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadAuthorizedPushMessage).mockResolvedValue({ conversationId: 'c' });
  vi.mocked(deliverWebPush).mockResolvedValue('sent');
});
it('revalida a mensagem, a inscrição por escritório/usuário e a posse do trabalho antes da entrega', async () => {
  const { admin, rpc, filters } = database();
  expect(await dispatchPendingPush(admin, config)).toBe(1);
  expect(loadAuthorizedPushMessage).toHaveBeenCalledWith(admin, row);
  expect(filters).toEqual(expect.arrayContaining([['crm_push_subscriptions', 'organization_id', 'org'],
    ['crm_push_subscriptions', 'user_id', 'u'], ['crm_push_subscriptions', 'id', 's'], ['crm_push_deliveries', 'lease_token', 'lease']]));
  expect(deliverWebPush).toHaveBeenCalledWith(device, { kind: 'lead_message', eventId: '1', userId: 'u', organizationId: 'org', conversationId: 'c' }, config);
  expect(rpc).toHaveBeenLastCalledWith('finish_crm_push_delivery', { p_id: 'entrega', p_lease: 'lease', p_outcome: 'sent' });
});
it('descarta o evento quando a pessoa perdeu o acesso ou alterou o escopo dos avisos', async () => {
  vi.mocked(loadAuthorizedPushMessage).mockResolvedValue(null);
  const { admin, rpc, from } = database();
  await dispatchPendingPush(admin, config);
  expect(from).not.toHaveBeenCalled(); expect(deliverWebPush).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenLastCalledWith('finish_crm_push_delivery', expect.objectContaining({ p_outcome: 'skip' }));
});
it('reagenda em caso de erro temporário na consulta e não envia sem conferir', async () => {
  vi.mocked(loadAuthorizedPushMessage).mockRejectedValue(new Error('temporário'));
  const { admin, rpc } = database();
  await dispatchPendingPush(admin, config);
  expect(deliverWebPush).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenLastCalledWith('finish_crm_push_delivery', expect.objectContaining({ p_outcome: 'retry' }));
});
it('não despacha uma inscrição removida depois da reserva', async () => {
  const { admin, rpc } = database(null);
  await dispatchPendingPush(admin, config);
  expect(deliverWebPush).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenLastCalledWith('finish_crm_push_delivery', expect.objectContaining({ p_outcome: 'skip' }));
});
it('um worker antigo não envia nem encerra a reserva do sucessor', async () => {
  const { admin, rpc } = database(device, null);
  await dispatchPendingPush(admin, config);
  expect(deliverWebPush).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
});
it('só revoga uma inscrição expirada sob a reserva que recebeu a recusa', async () => {
  vi.mocked(deliverWebPush).mockResolvedValue('gone');
  const { admin, rpc } = database();
  await dispatchPendingPush(admin, config);
  expect(rpc).toHaveBeenLastCalledWith('finish_crm_push_delivery', { p_id: 'entrega', p_lease: 'lease', p_outcome: 'gone' });
});
