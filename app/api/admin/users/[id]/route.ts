import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { UserRole } from '@/types/constants';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Handler HTTP `DELETE` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisição.
 * @param {{ params: Promise<{ id: string; }>; }} ctx - Contexto de execução.
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { id } = await ctx.params;

  const supabase = await createClient();
  const admin = createStaticAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: me, error: meError } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (meError || !me?.organization_id) return json({ error: 'Profile not found' }, 404);
  // ORG POR ABA: honra o header x-org-id validado (ver lib/supabase/tabOrgScope)
  const scoped = await withTabOrg({ id: user.id, role: me.role, organization_id: me.organization_id });
  if (!scoped) return json({ error: 'Acesso negado a esta organização' }, 403);
  if (scoped.role !== UserRole.ADMIN && scoped.role !== UserRole.SUPER_ADMIN) return json({ error: 'Forbidden' }, 403);

  if (id === user.id) return json({ error: 'Você não pode remover a si mesmo' }, 400);

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('id, email, organization_id, role')
    .eq('id', id)
    .maybeSingle();

  if (targetError) return json({ error: targetError.message }, 500);
  if (!target) return json({ error: 'User not found' }, 404);

  // Usuário multi-org: remover daqui NÃO pode apagar a conta inteira (ele
  // continua nas outras organizações). Remove só o vínculo com ESTA org e,
  // se ela era a org ativa dele, move a sessão pra outra org que ele tem.
  const { data: memberships, error: membershipsError } = await admin
    .from('user_organizations')
    .select('organization_id, role')
    .eq('user_id', id);
  // Caminho destrutivo e irreversível: se não conseguimos LER os vínculos, NÃO
  // dá pra concluir que é a última org — abortar em vez de apagar a conta toda.
  if (membershipsError) {
    return json({ error: `Falha ao verificar organizações do usuário: ${membershipsError.message}` }, 500);
  }

  // Autorização: o alvo precisa PERTENCER a esta org — org ativa aqui OU vínculo
  // aqui (membro multi-org com a org ativa em outro lugar). Sem isso, 403.
  const hasMembershipHere = (memberships || []).some((m) => m.organization_id === scoped.organization_id);
  const isMemberHere = target.organization_id === scoped.organization_id || hasMembershipHere;
  if (!isMemberHere) return json({ error: 'Forbidden' }, 403);

  const otherOrgs = (memberships || []).filter((m) => m.organization_id !== scoped.organization_id);

  // Remover só o vínculo (sem apagar a conta) quando o usuário AINDA tem onde
  // ficar depois: outro vínculo OU a org ativa dele é outra que não esta.
  // Só apaga a conta inteira quando esta org é o ÚNICO lugar dele.
  const stillHasHome = otherOrgs.length > 0 || target.organization_id !== scoped.organization_id;

  if (stillHasHome) {
    const { error: membershipError } = await admin
      .from('user_organizations')
      .delete()
      .eq('user_id', id)
      .eq('organization_id', scoped.organization_id);
    if (membershipError) return json({ error: `Falha ao remover: ${membershipError.message}` }, 500);

    // Só precisa mover a org ativa se ELA era esta org (senão o usuário
    // continua na org ativa dele, intacto).
    if (target.organization_id === scoped.organization_id && otherOrgs.length > 0) {
      const next = otherOrgs[0];
      const updates: Record<string, unknown> = {
        organization_id: next.organization_id,
        updated_at: new Date().toISOString(),
      };
      // Papel acompanha o vínculo da org de destino (super_admin não rebaixa)
      if (target.role !== UserRole.SUPER_ADMIN && next.role) {
        updates.role = next.role;
      }
      const { error: moveError } = await admin.from('profiles').update(updates).eq('id', id);
      if (moveError) return json({ error: `Falha ao remover: ${moveError.message}` }, 500);
    }

    return json({ ok: true, removedMembershipOnly: true });
  }

  // Try to delete auth user first, but don't block if it fails
  // (orphaned profiles without auth records should still be removable).
  // Com as FKs em ON DELETE SET NULL, os registros do usuário (leads,
  // atividades, contatos...) ficam SEM responsável em vez de bloquear.
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(id);

  // Delete profile regardless — if auth deletion failed, the profile may be orphaned
  const { error: profileDeleteError } = await admin
    .from('profiles')
    .delete()
    .eq('id', id);

  // Sucesso REAL = o perfil sumiu (o retorno das duas tentativas pode
  // enganar: o cascade do auth já pode ter levado o perfil junto)
  const { data: stillThere } = await admin
    .from('profiles')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (stillThere) {
    const message = profileDeleteError?.message || authDeleteError?.message || 'motivo desconhecido';
    return json({ error: `Falha ao remover: ${message}` }, 500);
  }

  return json({ ok: true });
}
