import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * POST /api/superadmin/switch-org — Switch super_admin's active organization
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

  if (!profile || profile.role !== 'super_admin') {
    return json({ error: 'Unauthorized' }, 403);
  }

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

  // Update super_admin's active organization
  const { error } = await admin
    .from('profiles')
    .update({ organization_id: organizationId, updated_at: new Date().toISOString() })
    .eq('id', profile.id);

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, organization: org });
}
