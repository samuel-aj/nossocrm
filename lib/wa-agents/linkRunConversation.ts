import type { SupabaseClient } from '@supabase/supabase-js';

/** Vincula somente o lead explícito da execução, quando o robô adquire a conversa. */
export async function linkRunConversation(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  dealId: string | null,
): Promise<void> {
  if (!dealId) return;

  const { data: deal, error: dealError } = await admin.from('deals')
    .select('id, contact_id')
    .eq('organization_id', organizationId)
    .eq('id', dealId)
    .is('deleted_at', null)
    .maybeSingle();
  if (dealError) throw dealError;
  if (!deal?.contact_id) return;

  // A condição é avaliada no UPDATE: uma escolha manual concorrente é preservada.
  // O trigger existente valida o lead e sincroniza as etiquetas ao criar o vínculo.
  const { error } = await admin.from('wa_conversations')
    .update({ deal_id: deal.id })
    .eq('organization_id', organizationId)
    .eq('id', conversationId)
    .eq('contact_id', deal.contact_id)
    .eq('is_group', false)
    .is('deal_id', null);
  if (error) throw error;
}
