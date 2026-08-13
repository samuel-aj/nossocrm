/**
 * Injeta o header `x-org-id` (org fixada NESTA aba, ver lib/tabOrg) em todo
 * fetch same-origin pra /api/*. Instalado uma vez por aba (importado pelo
 * AuthContext). No servidor, as rotas validam o header (membership em
 * user_organizations, ou super_admin) e passam a operar na org DA ABA em vez
 * da org "ativa" do perfil — é isso que permite duas abas em orgs diferentes
 * sem uma derrubar a outra.
 */
import { readTabOrg } from './tabOrg';

let installed = false;

export function installTabOrgFetch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const isApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
      const orgId = isApi ? readTabOrg()?.id : null;
      if (orgId) {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined)
        );
        if (!headers.has('x-org-id')) headers.set('x-org-id', orgId);
        init = { ...init, headers };
      }
    } catch {
      // qualquer problema: segue sem header (o servidor usa a org do perfil)
    }
    return original(input, init);
  };
}
