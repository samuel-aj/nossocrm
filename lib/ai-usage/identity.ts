import type { SupabaseClient } from '@supabase/supabase-js';

/** The database validates the conversation/contact and keeps durable identity aliases. */
export async function resolveUsageAccount(admin: SupabaseClient, organizationId: string, conversationId: string): Promise<string> {
  const { data, error } = await admin.rpc('ai_usage_context', { p_org: organizationId, p_conversation: conversationId });
  if (error || typeof data !== 'string') throw new Error(`Não foi possível identificar o limite do atendimento: ${error?.message ?? 'resposta inválida'}`);
  return data;
}
