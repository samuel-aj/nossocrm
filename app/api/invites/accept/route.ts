import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { findAuthUserByEmail } from '@/lib/supabase/authUsers';
import { countOrgMembers } from '@/lib/supabase/orgMembers';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const AcceptInviteSchema = z
  .object({
    token: z.string().min(1),
    email: z.string().trim().email().toLowerCase(),
    password: z.string().min(6),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

/**
 * Handler HTTP `POST` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisição.
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function POST(req: Request) {
  // Mitigação CSRF: cria usuário (efeito colateral), só aceita same-origin.
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const raw = await req.json().catch(() => null);
  const parsed = AcceptInviteSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const { token, email, password, name } = parsed.data;

  const admin = createStaticAdminClient();

  const nowIso = new Date().toISOString();

  // Reivindicação ATÔMICA do convite: marca used_at só se ainda estiver nulo,
  // num único statement. Se duas pessoas usarem o MESMO link ao mesmo tempo,
  // só uma "ganha"; a outra recebe "já utilizado". Qualquer rejeição ou erro
  // daqui pra frente LIBERA o convite (used_at = null) pra pessoa certa poder
  // tentar de novo.
  const { data: invite, error: inviteError } = await admin
    .from('organization_invites')
    .update({ used_at: nowIso })
    .eq('token', token)
    .is('used_at', null)
    .select('id, token, email, role, expires_at, used_at, organization_id')
    .single();

  if (inviteError || !invite) {
    return json({ error: 'Convite inválido ou já foi utilizado' }, 400);
  }

  const releaseInvite = async () => {
    await admin.from('organization_invites').update({ used_at: null }).eq('id', invite.id);
  };

  if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) {
    await releaseInvite();
    return json({ error: 'Convite expirado' }, 400);
  }

  if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
    await releaseInvite();
    return json({ error: 'Este convite não é válido para este email' }, 400);
  }

  const displayName = name || email.split('@')[0];
  const userMetadata = {
    name: displayName,
    organization_id: invite.organization_id,
    role: invite.role,
  };

  let createdId: string | undefined;
  const fail = async (message: string, status: number, code?: string) => {
    if (createdId) {
      const { error } = await admin.auth.admin.deleteUser(createdId);
      if (error) return json({ error: 'Não foi possível concluir a criação. Fale com o suporte.' }, 500);
    }
    await releaseInvite();
    return json({ error: message, code }, status);
  };

  try {
    const existing = await findAuthUserByEmail(email);
    const linkMember = (userId: string) => admin.from('user_organizations').upsert({
      user_id: userId, organization_id: invite.organization_id, role: invite.role,
    }, { onConflict: 'user_id,organization_id', ignoreDuplicates: true });
    let userId: string;
    if (existing) {
      const { data: profile, error } = await admin.from('profiles')
        .select('organization_id, role').eq('id', existing.id).maybeSingle();
      if (error) return await fail('Não foi possível verificar a equipe. Tente novamente.', 503);
      if (!invite.email || !existing.invited_at || profile?.organization_id !== invite.organization_id || profile?.role !== invite.role) {
        return await fail('Este e-mail já tem conta. Entre com a senha atual ou peça ao administrador para usar “Por email”.', 409);
      }

      // O clique no e-mail já abre uma sessão, antes da primeira senha.
      // Para uma identidade confirmada, só o próprio destinatário pode defini-la.
      const client = await createClient();
      const { data: { user }, error: sessionError } = await client.auth.getUser();
      if (sessionError || !user || user.id !== existing.id || user.email?.toLowerCase() !== email) {
        return await fail('Para definir a senha, confirme o e-mail desta conta. Se já definiu a senha, entre pelo login.', 403, 'confirm_email');
      }
      userId = existing.id;
      const { data: updated, error: profileError } = await admin.from('profiles')
        .update({ name: displayName, first_name: displayName }).eq('id', userId)
        .eq('organization_id', invite.organization_id).eq('role', invite.role).select('id').single();
      if (profileError || !updated) return await fail('Não foi possível confirmar o perfil na equipe.', 503);
      const { error: linkError } = await linkMember(userId);
      if (linkError) return await fail('Não foi possível concluir o vínculo com a equipe. Tente novamente.', 503);

      const { error: passwordError } = await client.auth.updateUser({ password });
      if (passwordError && passwordError.code !== 'same_password') return await fail(passwordError.message, 400);
    } else {
      const { data: org, error: limitError } = await admin.from('organizations')
        .select('max_users').eq('id', invite.organization_id).single();
      if (limitError || !org) return await fail('Não foi possível verificar o limite da equipe.', 503);
      if (org.max_users && await countOrgMembers(admin, invite.organization_id) >= org.max_users) {
        return await fail(`A organização atingiu o limite de ${org.max_users} usuário(s).`, 400);
      }
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: userMetadata });
      if (error) return await fail(error.message, 400);
      userId = data.user.id;
      createdId = userId;
      const { error: profileError } = await admin.from('profiles').upsert({
        id: userId, email, name: displayName, first_name: displayName,
        organization_id: invite.organization_id, role: invite.role, updated_at: nowIso,
      }, { onConflict: 'id' });
      if (profileError) return await fail('Não foi possível criar o perfil da equipe.', 503);
      const { error: linkError } = await linkMember(userId);
      if (linkError) return await fail('Não foi possível concluir o vínculo com a equipe. Tente novamente.', 503);
    }
    return json({ ok: true, user: { id: userId, email } });
  } catch {
    return await fail('Não foi possível concluir o convite. Tente novamente.', 503);
  }
}
