/**
 * GET /api/org/visibility  (admin da organização)
 *   -> { rules: [{ user_id, rules }] }
 *
 * Lista as permissões de visualização configuradas na organização (uma linha
 * por usuário restringido; quem não aparece vê tudo).
 */
import { requireOrgUser, json, isOrgAdmin } from '@/lib/whatsapp/api';
import { normalizeVisibilityRules } from '@/lib/permissions/types';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Apenas administradores' }, 403);

  const { data, error } = await auth.admin
    .from('user_visibility_rules')
    .select('user_id, rules')
    .eq('organization_id', auth.user.organizationId);

  if (error) {
    // Banco ainda sem a migração: sem regras, em vez de derrubar a tela
    if (/user_visibility_rules/i.test(error.message) && /(does not exist|schema cache)/i.test(error.message)) {
      return json({ rules: [] });
    }
    return json({ error: error.message }, 500);
  }

  return json({
    rules: ((data ?? []) as Array<{ user_id: string; rules: unknown }>).map(r => ({
      user_id: r.user_id,
      rules: normalizeVisibilityRules(r.rules),
    })),
  });
}
