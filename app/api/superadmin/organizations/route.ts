import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { logSuperAdminAction } from '@/lib/security/auditLog';
import { findAuthUserByEmail } from '@/lib/supabase/authUsers';
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
    if (p.role === UserRole.ADMIN) entry.admins++;
    if (p.role === UserRole.VENDEDOR) entry.vendedores++;
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
 * POST /api/superadmin/organizations — Create a new organization.
 *
 * O admin inicial é OPCIONAL: sem email, a organização nasce vazia (usuários
 * entram depois por convite ou pelo próprio painel). Com email já cadastrado,
 * a conta EXISTENTE ganha acesso à nova organização (a senha atual continua
 * valendo e a org ativa dela não muda — ela troca pela tela de seleção);
 * um mesmo email pode ter várias organizações.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const admin = createStaticAdminClient();

  let body: { companyName?: string; adminEmail?: string; adminPassword?: string; adminName?: string; maxUsers?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const companyName = body.companyName?.trim() || '';
  const adminEmail = body.adminEmail?.trim().toLowerCase() || '';
  const adminPassword = body.adminPassword || '';
  const adminName = body.adminName?.trim() || '';
  const maxUsers = body.maxUsers;

  if (!companyName) {
    return json({ error: 'companyName é obrigatório' }, 400);
  }

  // Valida ANTES de criar a org, pra não precisar de rollback nos casos comuns.
  let existingAuthUser: Awaited<ReturnType<typeof findAuthUserByEmail>> = null;
  let existingProfileId: string | null = null;
  // Conta ATIVA de verdade = tem perfil E já logou (ou não é convite pendente).
  // Convite pendente (invited_at, nunca logou) tem perfil mas NÃO tem senha
  // usável, então é tratado como órfã: a senha informada é aplicada.
  let isActiveAccount = false;
  if (adminEmail) {
    existingAuthUser = await findAuthUserByEmail(admin, adminEmail);
    if (existingAuthUser) {
      const { data: existingProfile } = await admin
        .from('profiles')
        .select('id')
        .eq('id', existingAuthUser.id)
        .maybeSingle();
      existingProfileId = existingProfile?.id ?? null;
      const isPending = Boolean(existingAuthUser.invited_at && !existingAuthUser.last_sign_in_at);
      isActiveAccount = Boolean(existingProfileId) && !isPending;
    }
    // Só conta ativa dispensa senha (a dela continua valendo). Conta nova,
    // órfã ou convite pendente precisam de uma senha nova.
    if (!isActiveAccount && !adminPassword) {
      return json({ error: 'Senha é obrigatória para criar uma conta nova' }, 400);
    }
    if (!isActiveAccount && adminPassword.length < 6) {
      return json({ error: 'Senha deve ter pelo menos 6 caracteres' }, 400);
    }
  }

  // 1. Create organization
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({
      name: companyName,
      max_users: maxUsers || 1,
      is_active: true,
    })
    .select('id, name')
    .single();

  if (orgError) return json({ error: `Erro ao criar organização: ${orgError.message}` }, 500);

  // Sem admin: organização vazia, pronta pra receber gente depois.
  if (!adminEmail) {
    await logSuperAdminAction(admin, {
      action: 'superadmin.org.create',
      actor_id: me.id,
      org_id: org.id,
      resource_type: 'organization',
      resource_id: org.id,
      details: { org_name: org.name, admin_email: null },
    });
    return json({ ok: true, organization: org, admin: null });
  }

  const displayName = adminName || adminEmail.split('@')[0];
  let userId: string;
  let existingAccount = false;

  if (existingAuthUser && isActiveAccount) {
    // Conta ativa (tem perfil e já logou): só ganha acesso à nova org. NÃO
    // mexe na senha nem na org ativa dela.
    userId = existingAuthUser.id;
    existingAccount = true;
  } else if (existingAuthUser) {
    // Conta órfã (login sem perfil) ou convite pendente (sem senha usável):
    // reaproveita com a senha nova e o perfil na nova org.
    const { error: updateError } = await admin.auth.admin.updateUserById(existingAuthUser.id, {
      password: adminPassword,
      email_confirm: true,
      user_metadata: { name: displayName, role: UserRole.ADMIN, organization_id: org.id },
    });
    if (updateError) {
      await admin.from('organizations').delete().eq('id', org.id);
      return json({ error: `Erro ao reaproveitar conta: ${updateError.message}` }, 500);
    }
    userId = existingAuthUser.id;
  } else {
    // 2. Create auth user
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { name: displayName, role: UserRole.ADMIN, organization_id: org.id },
    });
    if (authError) {
      // Rollback org creation
      await admin.from('organizations').delete().eq('id', org.id);
      return json({ error: `Erro ao criar usuário: ${authError.message}` }, 500);
    }
    userId = authData.user.id;
  }

  // 3. Perfil: só cria/atualiza quando a conta é nova ou órfã. Conta ativa
  // mantém o perfil (e a org ativa) que já tem.
  if (!existingAccount) {
    await admin.from('profiles').upsert(
      {
        id: userId,
        email: adminEmail,
        name: displayName,
        role: UserRole.ADMIN,
        organization_id: org.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  }

  // Add to user_organizations junction table
  await admin.from('user_organizations').upsert(
    {
      user_id: userId,
      organization_id: org.id,
      role: UserRole.ADMIN,
    },
    { onConflict: 'user_id,organization_id' }
  );

  await logSuperAdminAction(admin, {
    action: 'superadmin.org.create',
    actor_id: me.id,
    org_id: org.id,
    resource_type: 'organization',
    resource_id: org.id,
    details: { org_name: org.name, admin_email: adminEmail, existing_account: existingAccount },
  });

  return json({
    ok: true,
    organization: org,
    admin: { id: userId, email: adminEmail, existing: existingAccount },
  });
}
