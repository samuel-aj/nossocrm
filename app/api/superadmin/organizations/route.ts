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
 * GET /api/superadmin/organizations — List all organizations with user counts
 */
export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const admin = createStaticAdminClient();

  // Get all organizations
  const { data: orgs, error: orgsError } = await admin
    .from('organizations')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (orgsError) return json({ error: orgsError.message }, 500);

  // Get user counts per org
  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('organization_id, role');

  if (profilesError) return json({ error: profilesError.message }, 500);

  // Aggregate counts
  const orgCounts = new Map<string, { total: number; admins: number; vendedores: number }>();
  for (const p of profiles || []) {
    if (!p.organization_id) continue;
    const entry = orgCounts.get(p.organization_id) || { total: 0, admins: 0, vendedores: 0 };
    entry.total++;
    if (p.role === 'admin') entry.admins++;
    if (p.role === 'vendedor') entry.vendedores++;
    orgCounts.set(p.organization_id, entry);
  }

  const result = (orgs || []).map(org => ({
    ...org,
    userCount: orgCounts.get(org.id)?.total || 0,
    adminCount: orgCounts.get(org.id)?.admins || 0,
    vendedorCount: orgCounts.get(org.id)?.vendedores || 0,
  }));

  return json({ organizations: result });
}

/**
 * POST /api/superadmin/organizations — Create a new organization with its first admin
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const admin = createStaticAdminClient();

  let body: { companyName: string; adminEmail: string; adminPassword: string; adminName: string; maxUsers: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { companyName, adminEmail, adminPassword, adminName, maxUsers } = body;

  if (!companyName?.trim() || !adminEmail?.trim() || !adminPassword?.trim()) {
    return json({ error: 'companyName, adminEmail e adminPassword são obrigatórios' }, 400);
  }

  if (adminPassword.length < 6) {
    return json({ error: 'Senha deve ter pelo menos 6 caracteres' }, 400);
  }

  // 1. Create organization
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({
      name: companyName.trim(),
      max_users: maxUsers || 1,
      is_active: true,
    })
    .select('id, name')
    .single();

  if (orgError) return json({ error: `Erro ao criar organização: ${orgError.message}` }, 500);

  // 2. Create auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: adminEmail.trim(),
    password: adminPassword,
    email_confirm: true,
    user_metadata: {
      name: adminName?.trim() || adminEmail.split('@')[0],
      role: 'admin',
      organization_id: org.id,
    },
  });

  if (authError) {
    // Rollback org creation
    await admin.from('organizations').delete().eq('id', org.id);
    return json({ error: `Erro ao criar usuário: ${authError.message}` }, 500);
  }

  // 3. Ensure profile exists (trigger should create it, but upsert to be safe)
  const userId = authData.user.id;
  await admin.from('profiles').upsert(
    {
      id: userId,
      email: adminEmail.trim(),
      name: adminName?.trim() || adminEmail.split('@')[0],
      role: 'admin',
      organization_id: org.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  // Add to user_organizations junction table
  await admin.from('user_organizations').upsert(
    {
      user_id: userId,
      organization_id: org.id,
      role: 'admin',
    },
    { onConflict: 'user_id,organization_id' }
  );

  return json({
    ok: true,
    organization: org,
    admin: { id: userId, email: adminEmail.trim() },
  });
}
