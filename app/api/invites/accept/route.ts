import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

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
 * Procura uma conta de login (auth) pelo email. A API admin não tem busca
 * direta por email, então pagina o listUsers (limite alto o bastante para
 * a base atual; para na primeira página incompleta).
 */
async function findAuthUserByEmail(
  admin: ReturnType<typeof createStaticAdminClient>,
  email: string
) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

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

  const { data: invite, error: inviteError } = await admin
    .from('organization_invites')
    // Performance: fetch only what we need (keeps payload small and avoids extra parsing).
    .select('id, token, email, role, expires_at, used_at, organization_id')
    .eq('token', token)
    .is('used_at', null)
    .single();

  if (inviteError || !invite) {
    return json({ error: 'Convite inválido ou já foi utilizado' }, 400);
  }

  // Performance: avoid multiple Date allocations.
  const nowIso = new Date().toISOString();
  if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) {
    return json({ error: 'Convite expirado' }, 400);
  }

  if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
    return json({ error: 'Este convite não é válido para este email' }, 400);
  }

  const displayName = name || email.split('@')[0];
  const userMetadata = {
    name: displayName,
    organization_id: invite.organization_id,
    role: invite.role,
  };

  // Um usuário removido da equipe fica com a conta de login órfã (o perfil
  // some, o email continua registrado no auth). Criar de novo falharia com
  // "email já registrado", então: órfã = reaproveita a conta com a senha
  // nova; com perfil ativo = conflito real, mensagem clara.
  let userId: string;
  const existingAuthUser = await findAuthUserByEmail(admin, email);

  if (existingAuthUser) {
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('id', existingAuthUser.id)
      .maybeSingle();

    if (existingProfile) {
      return json(
        { error: 'Este email já está em uso por uma conta ativa. Entre com esse email ou use outro.' },
        400
      );
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(existingAuthUser.id, {
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });

    if (updateError) return json({ error: updateError.message }, 400);

    userId = existingAuthUser.id;
  } else {
    const { data: authData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });

    if (createError) return json({ error: createError.message }, 400);

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
    // (órfã pré-existente) fica como estava.
    if (!existingAuthUser) {
      await admin.auth.admin.deleteUser(userId);
    }
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

  await admin
    .from('organization_invites')
    .update({ used_at: nowIso })
    .eq('id', invite.id);

  return json({ ok: true, user: { id: userId, email } });
}
