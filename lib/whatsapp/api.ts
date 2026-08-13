/**
 * Helpers para as rotas /api/whatsapp/* — autenticação + escopo por organização.
 *
 * Padrão do projeto: autentica pela sessão (cookie) e opera nos dados via
 * service role (admin), filtrando manualmente por organization_id. As tabelas
 * wa_* não têm policy de SELECT p/ usuários (token é segredo), então a leitura
 * acontece só por aqui (server-side).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';
import { UserRole } from '@/types/constants';

export function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export interface OrgUser {
  id: string;
  role: string;
  organizationId: string;
}

export type RequireOrgResult =
  | { ok: true; user: OrgUser; admin: SupabaseClient }
  | { ok: false; response: Response };

/** Autentica o usuário e devolve seu org + um client admin (service role). */
export async function requireOrgUser(): Promise<RequireOrgResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: json({ error: 'Unauthorized' }, 401) };

  const { data: me, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (error || !me?.organization_id) {
    return { ok: false, response: json({ error: 'Profile not found' }, 404) };
  }

  // ORG POR ABA: honra o header x-org-id (validado contra user_organizations)
  // pra aba operar na org fixada nela, não na org "ativa" do perfil.
  const scoped = await withTabOrg({ id: me.id, role: me.role, organization_id: me.organization_id });
  if (!scoped) {
    return { ok: false, response: json({ error: 'Acesso negado a esta organização' }, 403) };
  }

  return {
    ok: true,
    user: { id: scoped.id, role: scoped.role, organizationId: scoped.organization_id },
    admin: createStaticAdminClient(),
  };
}

export function isOrgAdmin(role: string): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}
