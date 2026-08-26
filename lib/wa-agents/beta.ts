/**
 * Chave da versão beta por organização: ai_feature_flags(key='wa_agents_beta').
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { WA_AGENTS_BETA_FLAG } from './types';

/** true só quando existe a linha da flag com enabled = true. Padrão: false. */
export async function isWaAgentsBetaEnabled(admin: SupabaseClient, organizationId: string): Promise<boolean> {
  try {
    const { data } = await admin
      .from('ai_feature_flags')
      .select('enabled')
      .eq('organization_id', organizationId)
      .eq('key', WA_AGENTS_BETA_FLAG)
      .maybeSingle();
    return (data as { enabled?: boolean } | null)?.enabled === true;
  } catch {
    return false;
  }
}
