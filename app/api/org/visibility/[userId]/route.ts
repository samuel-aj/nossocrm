/**
 * PUT /api/org/visibility/[userId]  (admin da organização)
 *   { rules: VisibilityRules } -> { ok, rules | null }
 *
 * Define o que o vendedor enxerga. Regra sem nenhuma restrição APAGA a linha
 * (sem linha = vê tudo, o padrão de sempre). Ids de equipe, quadros e números
 * são conferidos contra a organização; id de fora é recusado.
 *
 * Admin e super admin não podem ser restringidos (as funções do banco já os
 * ignoram; aqui a regra nem é salva).
 */
import { requireOrgUser, json, isOrgAdmin } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isValidUUID } from '@/lib/supabase/utils';
import { VisibilityRulesSchema, isUnrestricted } from '@/lib/permissions/types';
import { UserRole } from '@/types/constants';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ userId: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Apenas administradores' }, 403);

  const { userId } = await ctx.params;
  if (!isValidUUID(userId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  let body: { rules?: unknown };
  try {
    body = (await req.json()) as { rules?: unknown };
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'JSON inválido' }, 400);
  const parsed = VisibilityRulesSchema.safeParse(body.rules ?? {});
  if (!parsed.success) return json({ error: 'Regras inválidas' }, 400);
  const rules = parsed.data;

  // Alvo precisa ser MEMBRO da org e não pode ser admin/super admin
  const [{ data: perfil }, { data: vinculo }] = await Promise.all([
    auth.admin.from('profiles').select('id, role, organization_id').eq('id', userId).maybeSingle(),
    auth.admin
      .from('user_organizations')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  const p = perfil as { id: string; role: string; organization_id: string | null } | null;
  if (!p) return json({ error: 'Usuário não encontrado' }, 404);
  const ehMembro = !!vinculo || p.organization_id === orgId;
  if (!ehMembro) return json({ error: 'Usuário não é membro desta organização' }, 404);
  if (p.role === UserRole.ADMIN || p.role === UserRole.SUPER_ADMIN) {
    return json({ error: 'Administradores sempre veem tudo; a permissão vale só para vendedores' }, 400);
  }

  // Ids das listas precisam ser DESTA organização
  const teamIds = rules.deals.scope === 'team' ? rules.deals.team_user_ids : [];
  if (rules.deals.scope === 'team' && teamIds.length === 0) {
    return json({ error: 'Escolha ao menos um membro da equipe (ou use "Somente próprios")' }, 400);
  }
  if (teamIds.length > 0) {
    const [{ data: perfis }, { data: vinculos }] = await Promise.all([
      auth.admin.from('profiles').select('id').eq('organization_id', orgId).in('id', teamIds),
      auth.admin.from('user_organizations').select('user_id').eq('organization_id', orgId).in('user_id', teamIds),
    ]);
    const membros = new Set([
      ...((perfis ?? []) as Array<{ id: string }>).map(x => x.id),
      ...((vinculos ?? []) as Array<{ user_id: string }>).map(x => x.user_id),
    ]);
    if (teamIds.some(id => !membros.has(id))) {
      return json({ error: 'Membro da equipe não pertence a esta organização' }, 400);
    }
  }

  if (rules.boards.board_ids !== null) {
    if (rules.boards.board_ids.length === 0) {
      return json({ error: 'Escolha ao menos um quadro (ou deixe "Todos os quadros")' }, 400);
    }
    const { data: quadros } = await auth.admin
      .from('boards')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', rules.boards.board_ids);
    if ((quadros ?? []).length !== rules.boards.board_ids.length) {
      return json({ error: 'Quadro não pertence a esta organização' }, 400);
    }
  }

  if (rules.whatsapp.connection_ids !== null) {
    if (rules.whatsapp.connection_ids.length === 0) {
      return json({ error: 'Escolha ao menos um número (ou deixe "Todos os números")' }, 400);
    }
    const { data: conns } = await auth.admin
      .from('wa_connections')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', rules.whatsapp.connection_ids);
    if ((conns ?? []).length !== rules.whatsapp.connection_ids.length) {
      return json({ error: 'Número não pertence a esta organização' }, 400);
    }
  }

  // Sem restrição nenhuma: apaga a linha (padrão de sempre = vê tudo)
  if (isUnrestricted(rules)) {
    const { error } = await auth.admin
      .from('user_visibility_rules')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', userId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, rules: null });
  }

  const { error } = await auth.admin.from('user_visibility_rules').upsert(
    {
      organization_id: orgId,
      user_id: userId,
      rules,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    },
    { onConflict: 'organization_id,user_id' }
  );
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, rules });
}
