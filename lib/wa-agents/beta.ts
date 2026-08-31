/**
 * Liberação do módulo por organização (tabela ai_feature_flags).
 *
 * Regra atual (saiu da versão beta):
 * - ROBÔS: liberados para TODAS as organizações, sem chave.
 * - AGENTE DE IA: só com `wa_ai_agents_approved` ligada, e quem liga é o
 *   SUPER ADMIN da agência (o agente é vendido caso a caso). O admin do
 *   cliente não consegue se autoliberar.
 *
 * A chave antiga `wa_agents_beta` continua sendo lida como equivalente para
 * não derrubar quem já estava usando antes da migração.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { WA_AGENTS_BETA_FLAG, WA_AI_AGENTS_FLAG } from './types';

async function flagEnabled(admin: SupabaseClient, organizationId: string, key: string): Promise<boolean> {
  try {
    const { data } = await admin
      .from('ai_feature_flags')
      .select('enabled')
      .eq('organization_id', organizationId)
      .eq('key', key)
      .maybeSingle();
    return (data as { enabled?: boolean } | null)?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * true quando a organização pode usar o AGENTE DE IA. Padrão: false.
 * Aceita a chave nova ou a antiga da beta (organizações que já usavam).
 */
export async function isAiAgentsApproved(admin: SupabaseClient, organizationId: string): Promise<boolean> {
  if (await flagEnabled(admin, organizationId, WA_AI_AGENTS_FLAG)) return true;
  return flagEnabled(admin, organizationId, WA_AGENTS_BETA_FLAG);
}

/**
 * @deprecated Nome da época da beta. Hoje só o agente de IA é travado; use
 * `isAiAgentsApproved`. Mantido porque significa exatamente a mesma coisa.
 */
export const isWaAgentsBetaEnabled = isAiAgentsApproved;
