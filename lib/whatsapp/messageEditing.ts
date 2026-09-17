export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

export interface EditableMessage {
  deleted_at?: string | null;
  direction: string;
  sent_by: string | null;
  status: string;
  body: string | null;
  media_type?: string | null;
  evolution_message_id?: string | null;
  wa_timestamp?: string | null;
  created_at: string;
}

export function messageEditError(message: EditableMessage, userId: string, provider: string, now = Date.now()): string | null {
  if (message.deleted_at) return 'Esta mensagem foi excluída.';
  if (message.direction !== 'out' || message.sent_by !== userId) return 'Você só pode editar mensagens enviadas por você pelo CRM.';
  if (provider !== 'evolution') return 'Este tipo de conexão não permite editar mensagens.';
  if (!message.body || message.media_type || !message.evolution_message_id || !['sent', 'delivered', 'read'].includes(message.status)) {
    return 'Só é possível editar mensagens de texto já enviadas.';
  }
  const age = now - Date.parse(message.wa_timestamp || message.created_at);
  if (!Number.isFinite(age) || age < 0 || age >= MESSAGE_EDIT_WINDOW_MS) return 'O prazo de 15 minutos para editar esta mensagem terminou.';
  return null;
}
