type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' ? value as ObjectValue : {};
export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';
export const UNKNOWN_DELIVERY_ERROR = 'Evolution: falha de entrega informada pelo WhatsApp, sem motivo detalhado no retorno.';

/** Read only diagnostic fields, never serialize a complete provider payload. */
function details(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(v => details(v, depth + 1));
  const row = object(value);
  return ['code', 'title', 'message', 'reason', 'details', 'error', 'errors', 'error_data']
    .flatMap(key => details(row[key], depth + 1));
}

export function parseDeliveryStatus(value: unknown): { id: string; status: DeliveryStatus; error?: string } | null {
  const item = object(value);
  const update = object(item.update);
  const id = object(item.key).id ?? item.keyId;
  const raw = String(item.status ?? update.status ?? '').toUpperCase();
  const status = ({ SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed',
    '0': 'failed', '2': 'sent', '3': 'delivered', '4': 'read', '5': 'read' } as Record<string, DeliveryStatus>)[raw];
  if (typeof id !== 'string' || !id || !status) return null;
  if (status !== 'failed') return { id, status };
  const reason = [...new Set([item.error, item.errors, item.reason, item.message, item.response,
    update.error, update.errors, update.reason, update.message, update.response]
    .flatMap(v => details(v)))].join(' — ').trim().slice(0, 500);
  return { id, status, error: reason
    ? `Evolution: ${reason}`
    : UNKNOWN_DELIVERY_ERROR };
}

export const PREVIOUS_STATUSES: Record<DeliveryStatus, string[]> = {
  sent: ['queued'],
  delivered: ['queued', 'sent', 'failed'],
  read: ['queued', 'sent', 'delivered', 'failed'],
  failed: ['queued', 'sent', 'failed'],
};

// deno-lint-ignore no-explicit-any
export async function applyDeliveryStatus(db: any, organizationId: string, connectionId: string, value: unknown): Promise<void> {
  const event = parseDeliveryStatus(value);
  if (!event) return;
  const { data: message, error: lookupError } = await db.from('wa_messages')
    .select('id, error, wa_conversations!inner(connection_id)')
    .eq('organization_id', organizationId).eq('evolution_message_id', event.id)
    .eq('wa_conversations.connection_id', connectionId).maybeSingle();
  if (lookupError) throw new Error('Não foi possível localizar a mensagem para atualizar a entrega');
  if (!message) return;
  const failure = event.error === UNKNOWN_DELIVERY_ERROR ? message.error || event.error : event.error;
  const { error } = await db.from('wa_messages')
    .update({ status: event.status, error: event.status === 'failed' ? failure : null })
    .eq('organization_id', organizationId).eq('id', message.id)
    .in('status', PREVIOUS_STATUSES[event.status]);
  if (error) throw new Error('Não foi possível registrar o status de entrega');
}
