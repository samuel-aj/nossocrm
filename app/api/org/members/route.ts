/**
 * GET /api/org/members — nomes dos usuários da organização (qualquer membro).
 *
 * Payload mínimo (id + nome + role) para EXIBIR o responsável de um lead e
 * listar opções de atribuição. Inclui os super_admins (equipe da agência):
 * o organization_id deles muda quando trocam de organização ativa, então
 * sem isso o nome de um responsável super admin "sumia" (aparecia genérico).
 * A atribuição em si continua restrita a admin (validada no update).
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from('profiles')
    .select('id, first_name, last_name, nickname, email, role, organization_id')
    .or(`organization_id.eq.${auth.user.organizationId},role.eq.super_admin`)
    .limit(300);

  if (error) return json({ error: error.message }, 500);

  const members = (data ?? [])
    .map(p => ({
      id: p.id as string,
      role: (p.role as string) ?? 'user',
      name:
        (p.nickname as string) ||
        `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ||
        (p.email as string) ||
        'Usuário',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return json({ members });
}
