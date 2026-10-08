import type { SupabaseClient } from '@supabase/supabase-js';
import { brPhoneVariants } from '@/lib/phone';
import { META_WINDOW_MS } from './serviceWindow';

export const META_WINDOW_CLOSED = 'A janela de 24 horas deste número está fechada. Envie um modelo aprovado ou aguarde uma nova mensagem do contato neste número.';

/** Server-side guard: another sender's inbound message cannot authorize this send. */
export async function checkSendWindow(
  db: SupabaseClient,
  orgId: string,
  connection: { id: string; provider?: string | null },
  phone: string,
  options: { template?: boolean; isGroup?: boolean; now?: number } = {},
): Promise<string | null> {
  if (connection.provider !== 'meta_cloud' || options.template || options.isGroup) return null;
  const { data: conversations, error } = await db.from('wa_conversations').select('id')
    .eq('organization_id', orgId).eq('connection_id', connection.id)
    .in('wa_phone', brPhoneVariants(phone));
  if (error) return 'Não foi possível verificar a janela de atendimento. Tente novamente.';
  if (!conversations?.length) return META_WINDOW_CLOSED;
  const now = options.now ?? Date.now();
  const cutoff = new Date(now - META_WINDOW_MS).toISOString();
  const upper = new Date(now).toISOString();
  const { data: inbound, error: inboundError } = await db.from('wa_messages').select('id')
    .eq('organization_id', orgId).in('conversation_id', conversations.map(c => c.id))
    .eq('direction', 'in')
    .or(`and(wa_timestamp.gt.${cutoff},wa_timestamp.lte.${upper}),and(wa_timestamp.is.null,created_at.gt.${cutoff},created_at.lte.${upper})`)
    .limit(1);
  if (inboundError) return 'Não foi possível verificar a janela de atendimento. Tente novamente.';
  return inbound?.length ? null : META_WINDOW_CLOSED;
}
