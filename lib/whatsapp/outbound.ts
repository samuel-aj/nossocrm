import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SendResult } from './providers/types';
import { recordOutboundMessage, replicateOutboundToSiblings, type WaConnectionRow, type WaMessageRow } from './service';

export type OutboundRecord = Parameters<typeof recordOutboundMessage>[1];
export type OutboundHooks = {
  publicFailureMessage?: string;
  beforeDispatch?: (record: OutboundRecord) => Promise<void>;
  afterDispatch?: (result: SendResult) => Promise<void>;
  afterRecord?: (message: WaMessageRow) => Promise<void>;
};

/** Shared dispatch/history boundary. Hooks must succeed before proceeding; never retry a provider here. */
export async function dispatchOutbound(options: {
  admin: SupabaseClient;
  connection: WaConnectionRow;
  record: OutboundRecord;
  isGroup?: boolean;
  send: () => Promise<SendResult>;
  hooks?: OutboundHooks;
}) {
  const { admin, connection, record, hooks } = options;
  await hooks?.beforeDispatch?.(record);
  const result = await options.send();
  await hooks?.afterDispatch?.(result);
  const message = await recordOutboundMessage(admin, {
    ...record,
    providerMessageId: result.providerMessageId,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : hooks?.publicFailureMessage ?? result.error,
  });
  await hooks?.afterRecord?.(message);
  if (result.ok && !options.isGroup) {
    await replicateOutboundToSiblings(admin, connection, {
      toPhone: record.toPhone,
      text: message.body,
      providerMessageId: result.providerMessageId,
      mediaType: record.mediaType,
    });
  }
  return { result, message };
}
