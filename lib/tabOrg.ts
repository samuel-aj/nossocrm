/**
 * Marcação de organização POR ABA (sessionStorage) + anúncio de troca.
 *
 * Cada aba do CRM guarda aqui a org com que está trabalhando. Todo fluxo que
 * troca a org da sessão NESTA aba deve, após o POST dar certo e ANTES de
 * navegar/recarregar, chamar pinTabOrg (marca a aba) e announceOrgSwitch
 * (avisa as outras abas na hora, enquanto o documento antigo ainda está vivo).
 * Sem isso o OrgTabGuard entende a troca como vinda de fora e reage errado.
 */

export interface TabOrg {
  id: string;
  name: string;
}

export interface OrgSwitchRecord {
  orgId: string;
  orgName: string;
  byTab: string;
  ts: number;
}

export const TAB_ORG_KEY = 'crm_tab_org';
export const ORG_PRESENCE_CHANNEL = 'crm_tab_presence';
export const ORG_SWITCH_RECORD_KEY = 'crm_last_org_switch';
/** Janela em que o registro de troca ainda conta como "outra aba viva"
 *  (cobre o vão de reload da aba que trocou, quando ela não responde ping). */
export const ORG_SWITCH_RECORD_TTL_MS = 15_000;

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

/**
 * Anuncia às demais abas que ESTA aba acabou de trocar a org da sessão.
 * Push imediato via BroadcastChannel (chega até em janelas visíveis lado a
 * lado) + registro em localStorage que sobrevive ao reload desta aba, pra
 * outra aba saber da troca mesmo se o ping/pong cair no vão do reload.
 */
export function announceOrgSwitch(orgId: string, orgName?: string | null, byTab?: string): void {
  const name = orgName || 'Organização';
  const tab = byTab || Math.random().toString(36).slice(2);
  try {
    localStorage.setItem(
      ORG_SWITCH_RECORD_KEY,
      JSON.stringify({ orgId, orgName: name, byTab: tab, ts: Date.now() } satisfies OrgSwitchRecord)
    );
  } catch {
    // segue
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(ORG_PRESENCE_CHANNEL);
      ch.postMessage({ type: 'org-switched', orgId, orgName: name, from: tab });
      ch.close();
    }
  } catch {
    // segue
  }
}

export function readOrgSwitchRecord(): OrgSwitchRecord | null {
  try {
    const raw = localStorage.getItem(ORG_SWITCH_RECORD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrgSwitchRecord;
    if (!parsed || typeof parsed.orgId !== 'string' || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}
