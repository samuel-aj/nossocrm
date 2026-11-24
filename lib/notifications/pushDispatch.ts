import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAuthorizedPushMessage } from './pushEligibility';
import { deliverWebPush, type DeviceSubscription, type PushOutcome, type WebPushConfig } from './webPush';

interface Delivery {
  id: string;
  lease_token: string;
  event_id: string;
  organization_id: string;
  user_id: string;
  subscription_id: string;
  message_id: string;
}

async function dispatchOne(admin: SupabaseClient, row: Delivery, config: WebPushConfig): Promise<void> {
  let outcome: PushOutcome = 'skip';
  try {
    const message = await loadAuthorizedPushMessage(admin, row);
    if (message) {
      const [subscription, lease] = await Promise.all([
        admin.from('crm_push_subscriptions').select('endpoint,p256dh,auth').eq('id', row.subscription_id)
          .eq('organization_id', row.organization_id).eq('user_id', row.user_id).maybeSingle(),
        admin.from('crm_push_deliveries').select('id').eq('id', row.id).eq('lease_token', row.lease_token)
          .gt('lease_until', new Date().toISOString()).maybeSingle(),
      ]);
      if (subscription.error || lease.error) throw new Error('Não foi possível conferir a entrega.');
      if (!lease.data) return;
      if (subscription.data) {
        outcome = await deliverWebPush(subscription.data as DeviceSubscription, {
          kind: 'lead_message', eventId: String(row.event_id), organizationId: row.organization_id,
          userId: row.user_id, conversationId: message.conversationId,
        }, config);
      }
    }
  } catch {
    outcome = 'retry';
  }
  const result = await admin.rpc('finish_crm_push_delivery', { p_id: row.id, p_lease: row.lease_token, p_outcome: outcome });
  if (result.error) throw new Error('Não foi possível concluir o registro da entrega.');
}

export async function dispatchPendingPush(admin: SupabaseClient, config: WebPushConfig) {
  const batch = await admin.rpc('claim_crm_push_deliveries', { p_limit: 24 });
  if (batch.error) throw new Error('Não foi possível consultar a fila de push.');
  const rows = (batch.data ?? []) as Delivery[];
  let bookkeepingFailed = false;
  for (let offset = 0; offset < rows.length; offset += 6) {
    const settled = await Promise.allSettled(rows.slice(offset, offset + 6).map(row => dispatchOne(admin, row, config)));
    if (settled.some(result => result.status === 'rejected')) bookkeepingFailed = true;
  }
  if (bookkeepingFailed) throw new Error('Falha ao registrar uma ou mais entregas de push.');
  return rows.length;
}
