import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { logSuperAdminAction } from '@/lib/security/auditLog';
import { UserRole } from '@/types/constants';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function requireSuperAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== UserRole.SUPER_ADMIN) return null;
  return profile;
}

/**
 * GET /api/superadmin/collaborators — List all super_admin users
 */
export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const admin = createStaticAdminClient();

  const { data: superAdmins, error } = await admin
    .from('profiles')
    .select('id, email, name, role, created_at')
    .eq('role', UserRole.SUPER_ADMIN)
    .order('created_at', { ascending: true });

  if (error) return json({ error: error.message }, 500);

  const list = superAdmins || [];
  if (list.length === 0) return json({ collaborators: [] });

  // Orgs em que cada super admin é MEMBRO (vínculo explícito em
  // user_organizations). Super admin não pertence a nenhuma org por padrão.
  const [{ data: links, error: linksError }, { data: orgs, error: orgsError }] = await Promise.all([
    admin
      .from('user_organizations')
      .select('user_id, organization_id, role')
      .in('user_id', list.map(p => p.id)),
    admin.from('organizations').select('id, name').is('deleted_at', null),
  ]);
  if (linksError) return json({ error: linksError.message }, 500);
  if (orgsError) return json({ error: orgsError.message }, 500);

  const orgName = new Map((orgs || []).map(o => [o.id as string, o.name as string]));
  const byUser = new Map<string, { organization_id: string; name: string; role: string }[]>();
  for (const l of links || []) {
    const name = orgName.get(l.organization_id as string);
    if (!name) continue; // org excluída
    const arr = byUser.get(l.user_id as string) || [];
    arr.push({ organization_id: l.organization_id as string, name, role: l.role as string });
    byUser.set(l.user_id as string, arr);
  }

  return json({
    collaborators: list.map(p => ({
      ...p,
      memberships: (byUser.get(p.id) || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    })),
  });
}

/**
 * POST /api/superadmin/collaborators — Promote a user to super_admin by email
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const admin = createStaticAdminClient();

  let body: { email: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { email } = body;
  if (!email?.trim()) {
    return json({ error: 'Email é obrigatório' }, 400);
  }

  // Find user by email
  const { data: targetProfile, error: findError } = await admin
    .from('profiles')
    .select('id, email, name, role')
    .eq('email', email.trim().toLowerCase())
    .single();

  if (findError || !targetProfile) {
    return json({ error: 'Usuário não encontrado com esse email' }, 404);
  }

  if (targetProfile.role === UserRole.SUPER_ADMIN) {
    return json({ error: 'Esse usuário já é Super Admin' }, 400);
  }

  // Promote to super_admin
  const { error: updateError } = await admin
    .from('profiles')
    .update({ role: UserRole.SUPER_ADMIN })
    .eq('id', targetProfile.id);

  if (updateError) {
    return json({ error: `Erro ao promover: ${updateError.message}` }, 500);
  }

  await logSuperAdminAction(admin, {
    action: 'superadmin.user.promote',
    actor_id: me.id,
    resource_type: 'user',
    resource_id: targetProfile.id,
    details: { email: targetProfile.email, previous_role: targetProfile.role },
    severity: 'critical',
  });

  return json({
    ok: true,
    message: `${targetProfile.name || targetProfile.email} promovido a Super Admin`,
  });
}

/**
 * DELETE /api/superadmin/collaborators — Revoke super_admin (back to admin)
 */
export async function DELETE(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const admin = createStaticAdminClient();

  let body: { userId: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { userId } = body;

  // Can't remove yourself
  if (userId === me.id) {
    return json({ error: 'Você não pode remover a si mesmo' }, 400);
  }

  const { error } = await admin
    .from('profiles')
    .update({ role: UserRole.ADMIN })
    .eq('id', userId);

  if (error) return json({ error: error.message }, 500);

  await logSuperAdminAction(admin, {
    action: 'superadmin.user.demote',
    actor_id: me.id,
    resource_type: 'user',
    resource_id: userId,
    severity: 'critical',
  });

  return json({ ok: true });
}
