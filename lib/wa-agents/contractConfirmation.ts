import type { SupabaseClient } from '@supabase/supabase-js';

/** The confirmation worker owns the next transition, including delivery of the link. */
export type ContractTurnWait = 'confirmation' | 'delivery' | 'team';
export function contractTurnWait(tool: string, output: unknown): ContractTurnWait | null {
  if (tool !== 'contrato_zapsign' || !output || typeof output !== 'object' || !('ok' in output) || output.ok !== true) return null;
  if ('aguardando_confirmacao_zapsign' in output && output.aguardando_confirmacao_zapsign === true) {
    if (('prazo_confirmacao_encerrado' in output && output.prazo_confirmacao_encerrado === true)
      || ('entrega_sob_responsabilidade_da_equipe' in output && output.entrega_sob_responsabilidade_da_equipe === true)) return 'team';
    return 'confirmation';
  }
  if ('aguarda_assinatura_no_atendimento' in output && output.aguarda_assinatura_no_atendimento === true) return 'delivery';
  return null;
}

export async function contractConfirmationDue(admin: SupabaseClient, org: string, conversation: string, conv: {
  ai_agent_id?: string | null; connection_id?: string | null; contact_id?: string | null; deal_id?: string | null;
  ai_status_changed_at?: string | null; wa_phone?: string | null;
}, now = new Date()): Promise<string | null> {
  if (!conv.deal_id || !conv.contact_id || !conv.connection_id || !conv.ai_agent_id || !conv.wa_phone) return null;
  const { data, error } = await admin.from('deal_signatures').select('created_at')
    .eq('organization_id', org).eq('deal_id', conv.deal_id).eq('contact_id', conv.contact_id).eq('origin', 'agent')
    .eq('request->>await_provider_confirmation', 'true')
    .contains('request', { agent_delivery: 'conversation', agent_id: conv.ai_agent_id, conversation_id: conversation,
      connection_id: conv.connection_id, recipient: conv.wa_phone, confirmation_agent_state_at: conv.ai_status_changed_at ?? null })
    .is('confirmation_timed_out_at', null).eq('confirmation_delivery_suppressed', false)
    .or('status.eq.processing,and(status.eq.pending,sign_url.is.null,agent_client_signed_at.is.null)')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // The worker, not the model, owns the handoff when five minutes expire.
  return new Date(Math.max(Date.parse(data.created_at) + 5 * 60_000, now.getTime() + 1000)).toISOString();
}
