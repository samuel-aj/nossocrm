import 'server-only';
import { randomUUID } from 'node:crypto';
import type { OutboundRecord } from '@/lib/whatsapp/outbound';
import { checkDb, McpWhatsAppError, unavailable, type WhatsAppContext } from './access';
import type { SequenceInput, SequenceItem } from './schemas';
import { sha256 } from './uploads';

export type Operation = { operation_id: string; actor_id: string; conversation_id: string; connection_id: string };
export type ItemState = 'pending' | 'preparing' | 'dispatching' | 'accepted' | 'completed' | 'uncertain';
export type JournalItem = {
  item_id: string; position: number; payload: SequenceItem; state: ItemState; claim_token: string;
  record: OutboundRecord | null; provider_message_id: string | null; message_id: string | null;
  error_code: string | null; updated_at: string;
};
export interface Journal {
  create(input: SequenceInput): Promise<void>;
  load(operationId: string): Promise<{ operation: Operation; items: JournalItem[] }>;
  claim(operationId: string): Promise<JournalItem | null>;
  update(operationId: string, item: JournalItem, expected: ItemState[], values: Partial<JournalItem>): Promise<boolean>;
}
export function sequenceHash(input: SequenceInput) {
  // Construct a stable representation without normalizing any approved text.
  return sha256(JSON.stringify([input.conversationId, input.connectionId, input.items.map(i =>
    i.type === 'text' ? [i.itemId, i.type, i.text] : [i.itemId, i.type, i.attachmentId, i.caption ?? ''])]));
}
export function createJournal(ctx: WhatsAppContext): Journal {
  const scope = { organization_id: ctx.user.organizationId, api_key_id: ctx.apiKeyId };
  return {
    async create(input) {
      const { error } = await ctx.admin.rpc('mcp_wa_create_operation', {
        p_org: scope.organization_id, p_key: scope.api_key_id, p_operation: input.operationId,
        p_actor: ctx.user.id, p_conversation: input.conversationId, p_connection: input.connectionId,
        p_hash: sequenceHash(input), p_items: input.items,
      });
      if (error?.message?.includes('IDEMPOTENCY_CONFLICT')) throw new McpWhatsAppError('IDEMPOTENCY_CONFLICT', 'Este operationId já está associado a outro conteúdo ou destino. Não crie outro ID para contornar uma tentativa incerta.');
      checkDb(error);
    },
    async load(operationId) {
      const { data: operation, error } = await ctx.admin.from('mcp_wa_operations').select('*')
        .match({ ...scope, operation_id: operationId, actor_id: ctx.user.id }).maybeSingle();
      checkDb(error);
      if (!operation) unavailable();
      const result = await ctx.admin.from('mcp_wa_items').select('*').match({ ...scope, operation_id: operationId }).order('position');
      checkDb(result.error);
      return { operation, items: result.data as JournalItem[] };
    },
    async claim(operationId) {
      const { data, error } = await ctx.admin.rpc('mcp_wa_claim_item', { p_org: scope.organization_id, p_key: scope.api_key_id, p_operation: operationId, p_token: randomUUID() });
      checkDb(error);
      return data as JournalItem | null;
    },
    async update(operationId, item, expected, values) {
      const { data, error } = await ctx.admin.from('mcp_wa_items').update({ ...values, updated_at: new Date().toISOString() })
        .match({ ...scope, operation_id: operationId, item_id: item.item_id, claim_token: item.claim_token })
        .in('state', expected).select('item_id');
      checkDb(error);
      return !!data?.length;
    },
  };
}
