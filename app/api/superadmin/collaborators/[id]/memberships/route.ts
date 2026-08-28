import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { logSuperAdminAction } from '@/lib/security/auditLog';
import { UserRole } from '@/types/constants';

/**
 * Organizações em que um colaborador Super Admin é MEMBRO (vínculo em
 * `user_organizations`). Super admin não pertence a nenhuma org por padrão;
 * aqui o próprio super admin escolhe, sem convite, de quais orgs cada
 * colaborador participa (e com qual papel) para poder ser responsável por
 * leads e atividades nelas.
 */

type Ctx = { params: Promise<{ id: string }> };

const ORG_ROLES = new Set<string>([UserRole.ADMIN, UserRole.VENDEDOR]);

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

async function loadCollaborator(admin: ReturnType<typeof createStaticAdminClient>, id: string) {
  const { data } = await admin
    .from('profiles')
    .select('id, email, name, role')
    .eq('id', id)
    .maybeSingle();
  if (!data || data.role !== UserRole.SUPER_ADMIN) return null;
  return data;
}

/**
 * GET /api/superadmin/collaborators/[id]/memberships
 * Todas as organizações (não excluídas) com `member` + `role` do colaborador.
 */
export async function GET(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const { id } = await ctx.params;
  const admin = createStaticAdminClient();

  const target = await loadCollaborator(admin, id);
  if (!target) return json({ error: 'Colaborador não encontrado' }, 404);

  const [{ data: orgs, error: orgsError }, { data: links, error: linksError }] = await Promise.all([
    admin.from('organizations').select('id, name, is_active').is('deleted_at', null).order('name'),
    admin.from('user_organizations').select('organization_id, role').eq('user_id', id),
  ]);
  if (orgsError) return json({ error: orgsError.message }, 500);
  if (linksError) return json({ error: linksError.message }, 500);

  const roleByOrg = new Map((links || []).map(l => [l.organization_id as string, l.role as string]));
  const organizations = (orgs || []).map(o => ({
    id: o.id as string,
    name: o.name as string,
    is_active: o.is_active as boolean,
    member: roleByOrg.has(o.id as string),
    role: roleByOrg.get(o.id as string) ?? null,
  }));

  return json({ collaborator: target, organizations });
}

/**
 * PUT /api/superadmin/collaborators/[id]/memberships
 * Body: { memberships: [{ organizationId, role: 'admin' | 'vendedor' }] }
 * Substitui o conjunto de vínculos do colaborador: cria/atualiza os enviados
 * e remove os que ficaram de fora. Não mexe na conta nem no papel super_admin.
 */
export async function PUT(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const me = await requireSuperAdmin(supabase);
  if (!me) return json({ error: 'Unauthorized' }, 403);

  const { id } = await ctx.params;
  const admin = createStaticAdminClient();

  const target = await loadCollaborator(admin, id);
  if (!target) return json({ error: 'Colaborador não encontrado' }, 404);

  let body: { memberships?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!Array.isArray(body.memberships)) {
    return json({ error: 'memberships deve ser uma lista' }, 400);
  }

  const { data: orgs, error: orgsError } = await admin
    .from('organizations')
    .select('id')
    .is('deleted_at', null);
  if (orgsError) return json({ error: orgsError.message }, 500);
  const validOrgs = new Set((orgs || []).map(o => o.id as string));

  // Normaliza: 1 entrada por org, papel válido, org existente.
  const desired = new Map<string, string>();
  for (const raw of body.memberships as unknown[]) {
    if (!raw || typeof raw !== 'object') return json({ error: 'Vínculo inválido' }, 400);
    const { organizationId, role } = raw as { organizationId?: unknown; role?: unknown };
    if (typeof organizationId !== 'string' || !validOrgs.has(organizationId)) {
      return json({ error: 'Organização inválida' }, 400);
    }
    if (typeof role !== 'string' || !ORG_ROLES.has(role)) {
      return json({ error: 'Papel inválido (use admin ou vendedor)' }, 400);
    }
    desired.set(organizationId, role);
  }

  const { data: current, error: currentError } = await admin
    .from('user_organizations')
    .select('organization_id, role')
    .eq('user_id', id);
  if (currentError) return json({ error: currentError.message }, 500);

  const currentByOrg = new Map((current || []).map(l => [l.organization_id as string, l.role as string]));
  const removed = [...currentByOrg.keys()].filter(orgId => !desired.has(orgId));
  const added = [...desired.keys()].filter(orgId => !currentByOrg.has(orgId));
  const changed = [...desired.entries()]
    .filter(([orgId, role]) => currentByOrg.has(orgId) && currentByOrg.get(orgId) !== role)
    .map(([orgId]) => orgId);

  if (removed.length > 0) {
    const { error } = await admin
      .from('user_organizations')
      .delete()
      .eq('user_id', id)
      .in('organization_id', removed);
    if (error) return json({ error: `Erro ao remover vínculo: ${error.message}` }, 500);
  }

  if (desired.size > 0) {
    const rows = [...desired.entries()].map(([organization_id, role]) => ({
      user_id: id,
      organization_id,
      role,
    }));
    const { error } = await admin
      .from('user_organizations')
      .upsert(rows, { onConflict: 'user_id,organization_id' });
    if (error) return json({ error: `Erro ao salvar vínculo: ${error.message}` }, 500);
  }

  await logSuperAdminAction(admin, {
    action: 'superadmin.user.memberships',
    actor_id: me.id,
    resource_type: 'user',
    resource_id: id,
    details: {
      email: target.email,
      added,
      removed,
      changed,
      memberships: [...desired.entries()].map(([organizationId, role]) => ({ organizationId, role })),
    },
    severity: 'warning',
  });

  return json({
    ok: true,
    memberships: [...desired.entries()].map(([organization_id, role]) => ({ organization_id, role })),
  });
}
