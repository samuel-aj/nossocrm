import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getTeamAccess } from '@/lib/permissions/teamAccessServer';
import { DEFAULT_ACTION_PERMISSIONS, normalizeVisibilityRules } from '@/lib/permissions/types';
import { DENIED_ACTIONS } from '@/lib/permissions/teamRoles';
export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  try {
    const access = await getTeamAccess(auth.admin, auth.user.organizationId, auth.user.id);
    let actions = access.fullAccess ? DEFAULT_ACTION_PERMISSIONS : DENIED_ACTIONS;
    if (access.legacy && !access.fullAccess) {
      const { data, error } = await auth.admin.from('user_visibility_rules').select('rules').eq('organization_id', auth.user.organizationId).eq('user_id', auth.user.id).maybeSingle();
      if (error) throw error;
      actions = normalizeVisibilityRules(data?.rules).actions;
    } else if (!access.fullAccess) {
      actions = { ...DENIED_ACTIONS, contacts: {
        view: access.boards.length > 0, create: access.boards.some(b => b.create),
        edit: access.boards.some(b => b.edit), delete: access.boards.some(b => b.delete),
      } };
    }
    return json({ ...access, actions });
  } catch {
    return json({ error: 'Falha ao consultar permissões' }, 503);
  }
}
