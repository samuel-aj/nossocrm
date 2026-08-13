/**
 * Resolução da organização ATUAL para as queries feitas no navegador.
 *
 * ORG POR ABA: cada aba fixa em sessionStorage (lib/tabOrg) a organização com
 * que está trabalhando, e é ELA que manda aqui — não a org "ativa" do perfil
 * (profiles.organization_id), que é global da sessão e mudaria junto em todas
 * as abas. Sem marcação (aba nova, login recente), cai na org do perfil e a
 * aba é marcada por quem inicializa (AuthContext).
 *
 * Segurança: o valor marcado na aba NÃO é confiável por si só — quem garante
 * o isolamento é a RLS (membership via user_organizations) e, nas rotas de
 * API, a validação do header x-org-id no servidor.
 */
import { supabase } from './client';
import { readTabOrg } from '@/lib/tabOrg';
import { sanitizeUUID } from './utils';

let cachedOrgId: string | null = null;
let cachedOrgUserId: string | null = null;

export function invalidateOrgCache() {
  cachedOrgId = null;
  cachedOrgUserId = null;
}

export async function getCurrentOrganizationId(): Promise<string | null> {
  const pinned = sanitizeUUID(readTabOrg()?.id ?? null);
  if (pinned) return pinned;

  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  if (cachedOrgUserId === user.id && cachedOrgId) return cachedOrgId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (error) return null;

  const orgId = sanitizeUUID((profile as { organization_id?: string } | null)?.organization_id);
  cachedOrgUserId = user.id;
  cachedOrgId = orgId;
  return orgId;
}
