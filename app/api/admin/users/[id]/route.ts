import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { UserRole } from '@/types/constants';

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
  if (me.role !== UserRole.ADMIN && me.role !== UserRole.SUPER_ADMIN) return json({ error: 'Forbidden' }, 403);

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
  // (orphaned profiles without auth records should still be removable).
  // Com as FKs em ON DELETE SET NULL, os registros do usuário (leads,
  // atividades, contatos...) ficam SEM responsável em vez de bloquear.
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(id);

  // Delete profile regardless — if auth deletion failed, the profile may be orphaned
  const { error: profileDeleteError } = await admin
    .from('profiles')
    .delete()
    .eq('id', id);

  // Sucesso REAL = o perfil sumiu (o retorno das duas tentativas pode
  // enganar: o cascade do auth já pode ter levado o perfil junto)
  const { data: stillThere } = await admin
    .from('profiles')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (stillThere) {
    const message = profileDeleteError?.message || authDeleteError?.message || 'motivo desconhecido';
    return json({ error: `Falha ao remover: ${message}` }, 500);
  }

  return json({ ok: true });
}
