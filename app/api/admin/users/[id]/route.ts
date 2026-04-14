import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

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
  const admin = createStaticAdminClient();

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
  if (me.role !== 'admin' && me.role !== 'super_admin') return json({ error: 'Forbidden' }, 403);

  if (id === user.id) return json({ error: 'Você não pode remover a si mesmo' }, 400);

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('id, email, organization_id')
    .eq('id', id)
    .maybeSingle();

  if (targetError) return json({ error: targetError.message }, 500);
  if (!target) return json({ error: 'User not found' }, 404);
  if (target.organization_id !== me.organization_id) return json({ error: 'Forbidden' }, 403);

  // Try to delete auth user first, but don't block if it fails
  // (orphaned profiles without auth records should still be removable)
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(id);

  // Delete profile regardless — if auth deletion failed, the profile may be orphaned
  const { error: profileDeleteError } = await admin
    .from('profiles')
    .delete()
    .eq('id', id);

  if (authDeleteError && profileDeleteError) {
    return json({ error: `Falha ao remover: ${authDeleteError.message}` }, 500);
  }

  return json({ ok: true });
}
