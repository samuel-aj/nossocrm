import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { logSuperAdminAction } from '@/lib/security/auditLog';
import { UserRole } from '@/types/constants';

/**
 * Super admin define uma senha nova para QUALQUER conta (cliente esqueceu a
 * senha e não há como recuperar por dentro). Só super_admin; a senha nunca é
 * gravada no log de auditoria, só quem trocou e de quem.
 */

type Ctx = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  password: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres').max(72, 'Senha longa demais'),
});

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * POST /api/superadmin/users/[id]/password
 * Body: { password }
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== UserRole.SUPER_ADMIN) return json({ error: 'Somente super admin pode alterar a senha de outra conta' }, 403);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || 'Dados inválidos' }, 400);

  const { id } = await ctx.params;
  const admin = createStaticAdminClient();

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, email, organization_id')
    .eq('id', id)
    .maybeSingle();
  if (targetError) return json({ error: targetError.message }, 500);
  if (!target) return json({ error: 'Usuário não encontrado' }, 404);

  const { error: updateError } = await admin.auth.admin.updateUserById(id, { password: parsed.data.password });
  if (updateError) return json({ error: `Não foi possível alterar a senha: ${updateError.message}` }, 400);

  await logSuperAdminAction(admin, {
    actor_id: me.id,
    org_id: target.organization_id,
    action: 'superadmin.user.password_reset',
    resource_type: 'user',
    resource_id: id,
    details: { email: target.email },
    severity: 'warning',
  });

  return json({ ok: true });
}
