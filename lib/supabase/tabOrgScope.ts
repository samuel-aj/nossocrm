/**
 * Org POR ABA no servidor.
 *
 * O navegador injeta o header `x-org-id` (org fixada na aba, lib/tabOrgFetch)
 * em todo fetch pra /api. Aqui o header é validado: o usuário precisa ter
 * vínculo com a org pedida (user_organizations) — ou ser super_admin — e o
 * "me" efetivo passa a apontar pra org DA ABA, com o papel do vínculo.
 *
 * Retorna null quando o header pede uma org à qual o usuário NÃO tem acesso
 * (a rota deve responder 403 em vez de cair silenciosamente na org do perfil,
 * senão a aba escreveria dados na organização errada).
 */
import { headers } from 'next/headers';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { UserRole } from '@/types/constants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OrgScoped {
  id: string;
  role: string;
  organization_id: string;
}

export async function withTabOrg<T extends OrgScoped>(me: T): Promise<T | null> {
  let requested = '';
  try {
    const h = await headers();
    requested = (h.get('x-org-id') || '').trim();
  } catch {
    return me; // fora de contexto de request (ex.: build): segue org do perfil
  }
  if (!requested || requested === me.organization_id) return me;
  if (!UUID_RE.test(requested)) return null;

  if (me.role === UserRole.SUPER_ADMIN) {
    return { ...me, organization_id: requested };
  }

  const admin = createStaticAdminClient();
  const { data: link } = await admin
    .from('user_organizations')
    .select('role')
    .eq('user_id', me.id)
    .eq('organization_id', requested)
    .maybeSingle();
  if (!link) return null;

  return {
    ...me,
    organization_id: requested,
    role: (link as { role?: string }).role || me.role,
  };
}
