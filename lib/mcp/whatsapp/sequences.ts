import 'server-only';
import { sendMessage } from '@/lib/whatsapp/sendMessage';
import { recordOutboundMessage, replicateOutboundToSiblings } from '@/lib/whatsapp/service';
import { checkDb, McpWhatsAppError, requireDestination, type WhatsAppContext } from './access';
import { createJournal, type Journal, type JournalItem } from './journal';
import { resolveAttachment } from './uploads';
import { validateSequence, type SequenceInput } from './schemas';

async function mustUpdate(store: Journal, operationId: string, item: JournalItem, expected: Parameters<Journal['update']>[2], values: Partial<JournalItem>) {
  if (!(await store.update(operationId, item, expected, values))) throw new McpWhatsAppError('CLAIM_LOST', 'Outra chamada está processando este item. Consulte a operação.');
}

export async function getSequence(ctx: WhatsAppContext, operationId: string, store = createJournal(ctx)) {
  const { operation, items } = await store.load(operationId);
  const { conversation, connection } = await requireDestination(ctx, operation.conversation_id, operation.connection_id);
  for (const item of items) {
    // Recover a confirmed acceptance after a crash between provider response and CRM persistence.
    // No provider call here. The CRM's unique provider ID also handles webhook echoes.
    if (item.state === 'accepted' && item.provider_message_id && item.record) {
      try {
        const message = await recordOutboundMessage(ctx.admin, { ...item.record, providerMessageId: item.provider_message_id, status: 'sent', error: null });
        await store.update(operationId, item, ['accepted'], { state: 'completed', message_id: message.id, error_code: null });
        if (!conversation.is_group) await replicateOutboundToSiblings(ctx.admin, connection, {
          toPhone: item.record.toPhone, text: message.body, providerMessageId: item.provider_message_id, mediaType: item.record.mediaType,
        });
      } catch { /* Leave accepted; a later query can reconcile without dispatching. */ }
    }
  }
  const current = await store.load(operationId);
  const ids = current.items.flatMap(i => i.message_id ? [i.message_id] : []);
  const messages = ids.length ? await ctx.admin.from('wa_messages').select('id,status,evolution_message_id')
    .eq('organization_id', ctx.user.organizationId).eq('conversation_id', operation.conversation_id).in('id', ids) : { data: [], error: null };
  checkDb(messages.error);
  const statuses = messages.data as { id: string; status: string }[] | null;
  const results = current.items.map(item => ({
    itemId: item.item_id, position: item.position, type: item.payload.type,
    state: (item.state === 'dispatching' && Date.now() - Date.parse(item.updated_at) > 90_000) || (item.state === 'accepted' && !item.provider_message_id && !item.message_id) ? 'uncertain' : item.state,
    messageId: item.message_id, providerMessageId: item.provider_message_id,
    deliveryStatus: statuses?.find(m => m.id === item.message_id)?.status ?? null,
    errorCode: item.error_code, retryAllowed: item.state === 'pending',
  }));
  return {
    operationId, organizationId: ctx.user.organizationId, conversationId: operation.conversation_id, connectionId: operation.connection_id,
    completed: results.every(i => i.state === 'completed'), items: results,
    next: results.some(i => ['uncertain', 'dispatching'].includes(i.state))
      ? 'Resultado não confirmado. Não reenvie, não troque operationId. Confira a operação/histórico e solicite reconciliação manual se não houver ID do provedor.'
      : 'Use resume com o mesmo operationId para processar somente os itens pendentes. Enviado não significa entregue ou lido.',
  };
}

export async function resumeSequence(ctx: WhatsAppContext, operationId: string, store = createJournal(ctx)) {
  const snapshot = await getSequence(ctx, operationId, store);
  if (snapshot.completed) return snapshot;
  // Leave room under the 60s route limit for a 15s PDF read + 25s provider request.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const item = await store.claim(operationId);
    if (!item) break;
    let dispatched = false;
    try {
      const { conversation, connection } = await requireDestination(ctx, snapshot.conversationId, snapshot.connectionId);
      if (connection.status !== 'connected') throw new McpWhatsAppError('DISCONNECTED', 'Conexão desconectada.');
      const media = item.payload.type === 'pdf' ? await resolveAttachment(ctx, item.payload.attachmentId, conversation.id, connection.id) : undefined;
      const response = await sendMessage({ ok: true, admin: ctx.admin, user: ctx.user }, {
        connectionId: connection.id, conversationId: conversation.is_group ? conversation.id : undefined,
        to: conversation.wa_phone, text: item.payload.type === 'text' ? item.payload.text : item.payload.caption,
        media,
      }, {
        exactConversation: conversation,
        signal: AbortSignal.timeout(25_000),
        hooks: {
          publicFailureMessage: 'Envio MCP sem confirmação. Consulte a operação antes de tentar novamente.',
          async beforeDispatch(record) {
            await mustUpdate(store, operationId, item, ['preparing'], { state: 'dispatching', record });
            dispatched = true;
          },
          async afterDispatch(result) {
            // Unknown/negative provider replies are deliberately NOT automatically retryable.
            await mustUpdate(store, operationId, item, ['dispatching'], {
              state: result.ok ? 'accepted' : 'uncertain', provider_message_id: result.providerMessageId ?? null,
              error_code: result.ok ? null : 'PROVIDER_NOT_CONFIRMED',
            });
          },
          async afterRecord(message) {
            // A concurrent get may already have reconciled this same provider ID.
            await mustUpdate(store, operationId, item, ['accepted', 'uncertain', 'completed'], {
              message_id: message.id,
              ...(message.status !== 'failed' ? { state: 'completed' as const } : {}),
            });
          },
        },
      });
      if (!response.ok) {
        if (!dispatched) {
          const body = await response.json().catch(() => ({}));
          await store.update(operationId, item, ['preparing'], { state: 'pending', error_code: body.code === 'WHATSAPP_SERVICE_WINDOW' ? body.code : 'PRECONDITION_FAILED' });
        }
        break;
      }
    } catch (error) {
      if (!dispatched) await store.update(operationId, item, ['preparing'], { state: 'pending', error_code: error instanceof McpWhatsAppError ? error.code : 'PREPARATION_FAILED' });
      else await store.update(operationId, item, ['dispatching'], { state: 'uncertain', error_code: 'PROVIDER_NOT_CONFIRMED' });
      break;
    }
  }
  return getSequence(ctx, operationId, store);
}

export async function sendSequence(ctx: WhatsAppContext, input: SequenceInput, store = createJournal(ctx)) {
  try { validateSequence(input); }
  catch { throw new McpWhatsAppError('INVALID_SEQUENCE', 'Use itemIds únicos e textos não vazios.'); }
  await requireDestination(ctx, input.conversationId, input.connectionId);
  await store.create(input);
  return resumeSequence(ctx, input.operationId, store);
}
