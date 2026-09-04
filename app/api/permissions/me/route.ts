/**
 * GET /api/permissions/me  (qualquer usuário logado)
 *   -> { actions: ActionPermissions }
 *
 * Permissões de AÇÃO do PRÓPRIO usuário na organização ativa, para a
 * interface esconder/desabilitar o que ele não pode fazer. A imposição de
 * verdade é no banco (triggers vis_guard_* e políticas restritivas) — esta
 * rota é só conforto de UX. Admins e quem não tem regra recebem tudo true.
 */
import { requireOrgUser, json, isOrgAdmin } from '@/lib/whatsapp/api';
import { DEFAULT_ACTION_PERMISSIONS, normalizeVisibilityRules } from '@/lib/permissions/types';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  if (isOrgAdmin(auth.user.role)) return json({ actions: DEFAULT_ACTION_PERMISSIONS });

  const { data, error } = await auth.admin
    .from('user_visibility_rules')
    .select('rules')
    .eq('organization_id', auth.user.organizationId)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  // Sem linha, tabela ausente ou erro: padrão liberado (a regra quebrada nunca
  // tranca o CRM; o banco continua sendo a imposição real)
  if (error || !data) return json({ actions: DEFAULT_ACTION_PERMISSIONS });

  return json({ actions: normalizeVisibilityRules((data as { rules: unknown }).rules).actions });
}
