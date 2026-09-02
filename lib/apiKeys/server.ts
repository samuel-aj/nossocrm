/**
 * Chaves da API pública: auth + escopo por organização ATUAL (a da aba) para
 * as rotas /api/api-keys. Só admin/super_admin da organização resolvida.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';

export const API_KEY_COLUMNS = 'id,name,key_prefix,created_at,last_used_at,revoked_at';

export type ApiKeysAuth = { userId: string; organizationId: string } | { error: string; status: number };

export async function getAuthedAdmin(): Promise<ApiKeysAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized', status: 401 };
  const { data: profile, error } = await supabase.from('profiles').select('organization_id, role').eq('id', user.id).single();
  if (error || !profile?.organization_id) return { error: 'Profile not found', status: 404 };
  // ORG POR ABA: honra o header x-org-id validado (ver lib/supabase/tabOrgScope)
  const scoped = await withTabOrg({ id: user.id, role: profile.role, organization_id: profile.organization_id });
  if (!scoped) return { error: 'Acesso negado a esta organização', status: 403 };
  if (scoped.role !== 'admin' && scoped.role !== 'super_admin') return { error: 'Forbidden', status: 403 };
  return { userId: user.id, organizationId: scoped.organization_id };
}

/** Mesmo formato da função create_api_key do banco: ncrm_ + 24 bytes em base64url, prefixo de 12, sha256 hex. */
export function makeApiKeyToken(): { token: string; prefix: string; hash: string } {
  const token = `ncrm_${randomBytes(24).toString('base64url')}`;
  return { token, prefix: token.slice(0, 12), hash: createHash('sha256').update(token).digest('hex') };
}
