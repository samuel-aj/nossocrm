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
 * POST /api/switch-org — Switch user's active organization
 * Works for any user with access to the target org (via user_organizations)
 * Super admins can switch to any org.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile) return json({ error: 'Profile not found' }, 404);

  let body: { organizationId: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { organizationId } = body;
  if (!organizationId) return json({ error: 'organizationId is required' }, 400);

  const admin = createStaticAdminClient();

  // Verify org exists
  const { data: org } = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', organizationId)
    .is('deleted_at', null)
    .single();

  if (!org) return json({ error: 'Organization not found' }, 404);

  // Check access: super_admin can access any org, others need user_organizations entry
  let membershipRole: string | null = null;
  if (profile.role !== UserRole.SUPER_ADMIN) {
    const { data: membership } = await admin
      .from('user_organizations')
      .select('id, role')
      .eq('user_id', profile.id)
      .eq('organization_id', organizationId)
      .single();

    if (!membership) return json({ error: 'Acesso negado a esta organização' }, 403);
    membershipRole = membership.role ?? null;
  }

  // Update user's active organization. O papel acompanha o vínculo da org de
  // destino (a mesma pessoa pode ser admin numa org e vendedor noutra);
  // super_admin nunca é rebaixado.
  const updates: Record<string, unknown> = {
    organization_id: organizationId,
    updated_at: new Date().toISOString(),
  };
  if (profile.role !== UserRole.SUPER_ADMIN && membershipRole) {
    updates.role = membershipRole;
  }
  const { error } = await admin
    .from('profiles')
    .update(updates)
    .eq('id', profile.id);

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, organization: org });
}
