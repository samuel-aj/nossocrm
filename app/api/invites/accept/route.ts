import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { findAuthUserByEmail } from '@/lib/supabase/authUsers';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const AcceptInviteSchema = z
  .object({
    token: z.string().min(1),
    email: z.string().email(),
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

  // Limite de usuários da organização (checado aqui porque é o convite que
  // materializa a conta; links podem ter sido gerados antes do limite lotar).
  const [{ data: orgLimits }, { count: memberCount }] = await Promise.all([
    admin.from('organizations').select('max_users').eq('id', invite.organization_id).single(),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', invite.organization_id),
  ]);

  // Um usuário removido da equipe fica com a conta de login órfã (o perfil
  // some, o email continua registrado no auth). Criar de novo falharia com
  // "email já registrado", então: órfã = reaproveita a conta com a senha
  // nova; com perfil ativo = conflito real, mensagem clara. Exceção: conta
  // criada pelo convite POR EMAIL desta mesma org (inviteUserByEmail, nunca
  // logou; o trigger já criou o perfil na org) também é reaproveitada.
  let userId: string;
  let profileAlreadyInOrg = false;
  const existingAuthUser = await findAuthUserByEmail(admin, email);

  if (existingAuthUser) {
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, organization_id')
      .eq('id', existingAuthUser.id)
      .maybeSingle();

    const isPendingInviteHere = Boolean(
      existingAuthUser.invited_at &&
        !existingAuthUser.last_sign_in_at &&
        existingProfile?.organization_id === invite.organization_id
    );

    if (existingProfile && !isPendingInviteHere) {
      await releaseInvite();
      return json(
        { error: 'Este email já está em uso por uma conta ativa. Entre com esse email ou use outro.' },
        400
      );
    }

    profileAlreadyInOrg = isPendingInviteHere;

    // Convite pendente já tem perfil contado no limite; os demais casos
    // adicionam +1 pessoa à org.
    if (!profileAlreadyInOrg && orgLimits?.max_users && (memberCount ?? 0) >= orgLimits.max_users) {
      await releaseInvite();
      return json(
        { error: `A organização atingiu o limite de ${orgLimits.max_users} usuário(s). Fale com quem te convidou.` },
        400
      );
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(existingAuthUser.id, {
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });

    if (updateError) {
      await releaseInvite();
      return json({ error: updateError.message }, 400);
    }

    userId = existingAuthUser.id;
  } else {
    if (orgLimits?.max_users && (memberCount ?? 0) >= orgLimits.max_users) {
      await releaseInvite();
      return json(
        { error: `A organização atingiu o limite de ${orgLimits.max_users} usuário(s). Fale com quem te convidou.` },
        400
      );
    }

    const { data: authData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });

    if (createError) {
      await releaseInvite();
      return json({ error: createError.message }, 400);
    }

    userId = authData.user.id;
  }

  const { error: profileError } = await admin
    .from('profiles')
    .upsert(
      {
        id: userId,
        email,
        name: displayName,
        first_name: displayName,
        organization_id: invite.organization_id,
        role: invite.role,
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    );

  if (profileError) {
    // Rollback apenas da conta que ESTE fluxo criou; conta reaproveitada
    // (órfã pré-existente) fica como estava. Libera o convite pra nova tentativa.
    if (!existingAuthUser) {
      await admin.auth.admin.deleteUser(userId);
    }
    await releaseInvite();
    return json({ error: profileError.message }, 400);
  }

  // Add to user_organizations junction table
  await admin
    .from('user_organizations')
    .upsert(
      {
        user_id: userId,
        organization_id: invite.organization_id,
        role: invite.role,
      },
      { onConflict: 'user_id,organization_id' }
    );

  // O convite já foi consumido atomicamente lá no começo (used_at = nowIso).
  return json({ ok: true, user: { id: userId, email } });
}
