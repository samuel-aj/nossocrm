import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * POST /api/superadmin/setup — One-time setup: apply migration + promote current admin to super_admin
 * Only works if no super_admin exists yet.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const admin = createStaticAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  // Check if caller is at least an admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return json({ error: 'Profile not found' }, 404);
  }

  // Already super_admin - return success
  if (profile.role === 'super_admin') {
    return json({ ok: true, message: 'Você já é super admin.' });
  }

  if (profile.role !== 'admin') {
    return json({ error: 'Apenas administradores podem executar o setup' }, 403);
  }

  // Check if another super_admin already exists
  const { data: existingSuperAdmin } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'super_admin')
    .limit(1);

  if (existingSuperAdmin && existingSuperAdmin.length > 0) {
    return json({ error: 'Super admin já configurado por outro usuário' }, 400);
  }

  // Apply migration: add columns if they don't exist
  // Using admin client to run raw SQL-like operations via individual column adds
  // The columns are added via ALTER TABLE IF NOT EXISTS in migration file,
  // but we do it here via Supabase API as a safety net
  try {
    // Try to add max_users column (will silently succeed if already exists via migration)
    // Try applying schema changes - RPC may not exist, migration file handles it
    const rpcResult = await admin.rpc('exec_sql', {
      sql: `
        ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 5;
        ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
        ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug TEXT;
      `
    });
    // Ignore RPC errors - columns may already exist or function may not exist
    void rpcResult;
  } catch {
    // Ignore - columns may already exist
  }

  // Promote current user to super_admin
  const { error: promoteError } = await admin
    .from('profiles')
    .update({ role: 'super_admin' })
    .eq('id', user.id);

  if (promoteError) {
    return json({ error: `Erro ao promover: ${promoteError.message}` }, 500);
  }

  return json({
    ok: true,
    message: 'Super admin configurado com sucesso. Recarregue a página.',
  });
}
