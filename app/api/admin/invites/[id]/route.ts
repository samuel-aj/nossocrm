import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { UserRole } from '@/types/constants';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Handler HTTP `DELETE` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisição.
 * @param {{ params: Promise<{ id: string; }>; }} ctx - Contexto de execução.
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { id } = await ctx.params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: me, error: meError } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (meError || !me?.organization_id) return json({ error: 'Profile not found' }, 404);
  // ORG POR ABA: honra o header x-org-id validado (ver lib/supabase/tabOrgScope)
  const scoped = await withTabOrg({ id: user.id, role: me.role, organization_id: me.organization_id });
  if (!scoped) return json({ error: 'Acesso negado a esta organização' }, 403);
  if (scoped.role !== UserRole.ADMIN && scoped.role !== UserRole.SUPER_ADMIN) return json({ error: 'Forbidden' }, 403);

  const { error } = await supabase
    .from('organization_invites')
    .delete()
    .eq('id', id)
    .eq('organization_id', scoped.organization_id);

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}
