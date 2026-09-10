import { z } from 'zod';
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getTeamAccess } from '@/lib/permissions/teamAccessServer';
import { TeamRoleSchema } from '@/lib/permissions/teamRoles';

const Mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('master'), data: z.object({ userId: z.string().uuid() }).strict() }).strict(),
  z.object({ action: z.literal('saveRole'), data: TeamRoleSchema.extend({ id: z.string().uuid().optional() }) }).strict(),
  z.object({ action: z.literal('deleteRole'), data: z.object({ id: z.string().uuid() }).strict() }).strict(),
  z.object({ action: z.literal('assign'), data: z.object({ userId: z.string().uuid(), kind: z.enum(['admin', 'vendedor']), roleId: z.string().uuid().nullable() }).strict() }).strict(),
]);
export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { organizationId: org, id } = auth.user;
  const access = await getTeamAccess(auth.admin, org, id);
  if (!access.fullAccess) return json({ error: 'Acesso negado' }, 403);
  const results = await Promise.all([
    auth.admin.from('team_roles').select('*').eq('organization_id', org).order('name'),
    auth.admin.from('team_role_assignments').select('user_id,role_id,legacy').eq('organization_id', org),
    auth.admin.from('boards').select('id,name').eq('organization_id', org).is('deleted_at', null).order('name'),
  ]);
  if (results.some(r => r.error)) return json({ error: 'Falha ao carregar a equipe' }, 500);
  return json({ ...access, isSuperAdmin: auth.user.role === 'super_admin', roles: results[0].data, assignments: results[1].data, availableBoards: results[2].data });
}
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Acesso negado' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const parsed = Mutation.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Configuração inválida', details: parsed.error.flatten() }, 400);
  const access = await getTeamAccess(auth.admin, auth.user.organizationId, auth.user.id);
  if (!access.canManage || (parsed.data.action === 'master' && auth.user.role !== 'super_admin')) return json({ error: 'Acesso negado' }, 403);
  const { error } = await auth.admin.rpc('team_manage', {
    p_org: auth.user.organizationId, p_actor: auth.user.id, p_action: parsed.data.action, p_data: parsed.data.data,
  });
  if (error) return json({ error: error.code === '23503' ? 'Esta função está em uso. Altere a atribuição dos membros antes de excluí-la.' : error.message }, error.code === '42501' ? 403 : 400);
  return json({ ok: true });
}
