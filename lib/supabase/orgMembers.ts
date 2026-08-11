import type { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

/**
 * "Membros" de uma organização = UNIÃO de duas fontes:
 *  - profiles cuja org ATIVA é esta (inclui super admins ativos aqui, que
 *    podem não ter linha em user_organizations);
 *  - user_organizations desta org (vínculos — inclui quem está com a org ativa
 *    em OUTRO lugar mas pertence a esta, por ex. admin dado pelo Super Admin).
 *
 * A união garante que ninguém que aparece hoje na lista suma, e ainda inclui
 * os membros multi-org. Precisa do admin client: a RLS de user_organizations
 * só deixa o usuário ver os PRÓPRIOS vínculos.
 */
export async function countOrgMembers(admin: AdminClient, orgId: string): Promise<number> {
  const [membersRes, profilesRes] = await Promise.all([
    admin.from('user_organizations').select('user_id').eq('organization_id', orgId),
    admin.from('profiles').select('id').eq('organization_id', orgId),
  ]);
  // Falha de leitura: contribui vazio (mesmo comportamento tolerante de antes,
  // quando o count vinha nulo). Não bloqueia adição legítima por erro passageiro.
  const ids = new Set<string>();
  for (const m of membersRes.data || []) if (m.user_id) ids.add(m.user_id as string);
  for (const p of profilesRes.data || []) if (p.id) ids.add(p.id as string);
  return ids.size;
}
