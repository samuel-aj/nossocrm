import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignatureRequest } from './signatures';

/** Bind only an unambiguous existing service session. This never activates an
 * agent, lifts a manual pause, or schedules a second signing invitation. */
export async function manualAgentFollowup(db: SupabaseClient, scope: {
  organizationId: string; dealId: string; contactId: string | null; templateToken: string;
}): Promise<Partial<SignatureRequest>> {
  if (!scope.contactId) return {};
  const { data, error } = await db.from('wa_conversations')
    .select('id,connection_id,wa_phone,ai_agent_id')
    .eq('organization_id', scope.organizationId).eq('deal_id', scope.dealId).eq('contact_id', scope.contactId)
    .eq('is_group', false).in('ai_status', ['active', 'paused']).not('ai_agent_id', 'is', null).limit(2);
  if (error) throw new Error('Não foi possível conferir o atendimento vinculado ao contrato.');
  if (data?.length !== 1) return {};
  const conv = data[0];
  if (!conv.connection_id || !conv.wa_phone) return {};
  const agent = await db.from('wa_ai_agents').select('tools,connection_ids')
    .eq('organization_id', scope.organizationId).eq('id', conv.ai_agent_id).eq('enabled', true).maybeSingle();
  if (agent.error) throw new Error('Não foi possível conferir o agente vinculado ao contrato.');
  if (agent.data?.tools?.zapsign_template_token !== scope.templateToken ||
      !agent.data?.connection_ids?.includes(conv.connection_id)) return {};
  return { agent_delivery: 'signed_only', agent_id: conv.ai_agent_id, conversation_id: conv.id,
    connection_id: conv.connection_id, recipient: conv.wa_phone };
}
