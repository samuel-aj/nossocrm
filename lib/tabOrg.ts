/**
 * Marcação de organização POR ABA (sessionStorage).
 *
 * Cada aba do CRM guarda aqui a org com que está trabalhando, e é ELA que
 * manda em toda a aba: nas queries diretas do navegador (lib/supabase/orgId),
 * no header x-org-id enviado pras rotas de API (lib/tabOrgFetch) e no perfil
 * exposto pelo AuthContext. Trocar de org numa aba NÃO afeta as outras —
 * profiles.organization_id vira só a org PADRÃO de abas novas.
 */

export interface TabOrg {
  id: string;
  name: string;
}

export const TAB_ORG_KEY = 'crm_tab_org';

export function pinTabOrg(id: string, name?: string | null): void {
  try {
    sessionStorage.setItem(TAB_ORG_KEY, JSON.stringify({ id, name: name || 'Organização' }));
  } catch {
    // sessionStorage indisponível: sem marcação (o guard também fica inerte)
  }
}

export function readTabOrg(): TabOrg | null {
  try {
    const raw = sessionStorage.getItem(TAB_ORG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TabOrg;
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null;
    return { id: parsed.id, name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Organização' };
  } catch {
    return null;
  }
}

export function clearTabOrg(): void {
  try {
    sessionStorage.removeItem(TAB_ORG_KEY);
  } catch {
    // segue
  }
}
