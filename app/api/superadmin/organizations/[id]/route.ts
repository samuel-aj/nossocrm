import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

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

  if (!profile || profile.role !== 'super_admin') return null;
  return profile;
}

/**
 * GET /api/superadmin/organizations/[id] — Get org details with members
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const { id } = await ctx.params;
  const admin = createStaticAdminClient();

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (orgError || !org) return json({ error: 'Organização não encontrada' }, 404);

  const { data: members } = await admin
    .from('profiles')
    .select('id, email, name, role, created_at')
    .eq('organization_id', id)
    .order('created_at', { ascending: true });

  return json({ organization: org, members: members || [] });
}

/**
 * PATCH /api/superadmin/organizations/[id] — Update org settings
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const { id } = await ctx.params;
  const admin = createStaticAdminClient();

  let body: { name?: string; max_users?: number; is_active?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.max_users !== undefined) updates.max_users = body.max_users;
  if (body.is_active !== undefined) updates.is_active = body.is_active;

  const { error } = await admin
    .from('organizations')
    .update(updates)
    .eq('id', id);

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}

/**
 * DELETE /api/superadmin/organizations/[id] — Soft-delete (deactivate) org
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const { id } = await ctx.params;
  const admin = createStaticAdminClient();

  // Don't allow deleting the super_admin's own org
  if (id === me.organization_id) {
    return json({ error: 'Você não pode desativar sua própria organização' }, 400);
  }

  const { error } = await admin
    .from('organizations')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}
