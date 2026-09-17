import type { EditableMessage } from './messageEditing';
export const MESSAGE_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;
export function messageDeleteError(message: EditableMessage, userId: string, provider: string, now = Date.now()): string | null {
  if (message.deleted_at) return 'Esta mensagem já foi excluída.';
  if (message.direction !== 'out' || message.sent_by !== userId) return 'Você só pode excluir mensagens enviadas por você pelo CRM.';
  if (provider !== 'evolution') return 'Esta conexão não permite excluir mensagens.';
  if (!message.evolution_message_id || !['sent', 'delivered', 'read'].includes(message.status)) return 'Aguarde a confirmação do envio.';
  const age = now - Date.parse(message.wa_timestamp || message.created_at);
  if (!Number.isFinite(age) || age < 0 || age >= MESSAGE_DELETE_WINDOW_MS) return 'O prazo para excluir esta mensagem terminou.';
  return null;
}
