/**
 * GET /api/org/members — usuários da organização (qualquer membro logado).
 *
 * Payload mínimo (id + nome + papel + member) para EXIBIR o responsável de um
 * lead/atividade e listar as opções de atribuição.
 *
 * MEMBRO da org = perfil com a org ATIVA aqui (exceto super_admin) OU vínculo
 * em user_organizations. Super admins (equipe da agência) NÃO viram membros só
 * por estarem navegando na org: só entram quando alguém os adiciona de
 * propósito (vínculo), e aí aparecem com o papel do vínculo (vendedor/admin),
 * podendo ser responsáveis por leads e atividades. Os demais super admins
 * ainda vêm na lista com member=false, só para o nome de um responsável
 * antigo não sumir (o organization_id deles muda ao trocar de org ativa).
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';

interface ProfileRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  email: string | null;
  role: string | null;
  organization_id: string | null;
}

/** Papel NESTA org a partir do vínculo: super_admin no vínculo conta como admin. */
function orgRole(role: string | null | undefined): string {
  if (!role || role === 'super_admin') return role === 'super_admin' ? 'admin' : 'vendedor';
  return role;
}

const PROFILE_COLS = 'id, first_name, last_name, nickname, email, role, organization_id';

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const [profilesRes, membershipsRes] = await Promise.all([
    auth.admin
      .from('profiles')
      .select(PROFILE_COLS)
      .or(`organization_id.eq.${orgId},role.eq.super_admin`)
      .limit(300),
    auth.admin.from('user_organizations').select('user_id, role').eq('organization_id', orgId),
  ]);
  if (profilesRes.error) return json({ error: profilesRes.error.message }, 500);
  if (membershipsRes.error) return json({ error: membershipsRes.error.message }, 500);

  const membershipRole = new Map<string, string>();
  for (const m of (membershipsRes.data ?? []) as Array<{ user_id: string | null; role: string | null }>) {
    if (m.user_id) membershipRole.set(m.user_id, orgRole(m.role));
  }

  const byId = new Map<string, ProfileRow>();
  for (const p of (profilesRes.data ?? []) as ProfileRow[]) byId.set(p.id, p);

  // Membros multi-org com a org ativa em outro lugar: perfil não veio acima
  const missing = [...membershipRole.keys()].filter(id => !byId.has(id));
  if (missing.length > 0) {
    const { data: extra } = await auth.admin.from('profiles').select(PROFILE_COLS).in('id', missing);
    for (const p of (extra ?? []) as ProfileRow[]) byId.set(p.id, p);
  }

  const members = [...byId.values()]
    .map(p => {
      const isSuperAdmin = p.role === 'super_admin';
      const linked = membershipRole.has(p.id);
      return {
        id: p.id,
        // papel NESTA org: o do vínculo quando existe; super admin sem vínculo continua super_admin
        role: linked ? (membershipRole.get(p.id) as string) : isSuperAdmin ? 'super_admin' : p.role ?? 'user',
        name:
          p.nickname ||
          `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ||
          p.email ||
          'Usuário',
        /** pode ser responsável por lead/atividade nesta org */
        member: linked || (!isSuperAdmin && p.organization_id === orgId),
        isSuperAdmin,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return json({ members });
}
