import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { findAuthUserByEmail } from '@/lib/supabase/authUsers';
import { countOrgMembers } from '@/lib/supabase/orgMembers';
import { UserRole } from '@/types/constants';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type Role = typeof UserRole.ADMIN | typeof UserRole.VENDEDOR;

const CreateInviteSchema = z
  .object({
    role: z.enum([UserRole.ADMIN, UserRole.VENDEDOR]).default(UserRole.VENDEDOR),
    expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
    email: z.string().email().optional(),
    /** true = além de criar o convite, envia o email pelo Supabase Auth. */
    sendEmail: z.boolean().optional(),
  })
  .strict();

/**
 * Handler HTTP `GET` deste endpoint (Next.js Route Handler).
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function GET() {
  const supabase = await createClient();

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
  if (me.role !== UserRole.ADMIN && me.role !== UserRole.SUPER_ADMIN) return json({ error: 'Forbidden' }, 403);

  // Return only active (not used) invites, and let UI decide how to show expiration.
  const { data: invites, error } = await supabase
    .from('organization_invites')
    .select('id, token, role, email, created_at, expires_at, used_at, created_by')
    .eq('organization_id', me.organization_id)
    .is('used_at', null)
    .limit(200)
    .order('created_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);

  return json({ invites: invites || [] });
}

/**
 * Handler HTTP `POST` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisição.
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();

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
  if (me.role !== UserRole.ADMIN && me.role !== UserRole.SUPER_ADMIN) return json({ error: 'Forbidden' }, 403);

  const raw = await req.json().catch(() => null);
  const parsed = CreateInviteSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[admin/invites POST] Validation error:', parsed.error.flatten());
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const expiresAt = parsed.data.expiresAt ?? null;
  const email = parsed.data.email?.trim().toLowerCase() || null;
  const sendEmail = Boolean(parsed.data.sendEmail && email);

  // Envio por email: valida ANTES de criar o convite. Email com conta ativa
  // não recebe o email do Supabase (a conta já existe) — mensagem clara.
  const admin = sendEmail ? createStaticAdminClient() : null;
  let staleAuthUserId: string | null = null;
  if (admin && email) {
    // Limite de usuários da org: o modo email materializa uma conta, então
    // conta pra vaga igual ao "login pronto" e ao convite por link no aceite.
    // Conta membros = perfis ativos aqui + vínculos multi-org (igual à lista).
    const [{ data: orgLimits }, memberCount] = await Promise.all([
      admin.from('organizations').select('max_users').eq('id', me.organization_id).single(),
      countOrgMembers(admin, me.organization_id),
    ]);
    if (orgLimits?.max_users && memberCount >= orgLimits.max_users) {
      return json(
        { error: `Limite de ${orgLimits.max_users} usuário(s) da organização atingido. Fale com o suporte pra aumentar.` },
        400
      );
    }

    const existingAuthUser = await findAuthUserByEmail(admin, email);
    if (existingAuthUser) {
      const { data: existingProfile } = await admin
        .from('profiles')
        .select('id, organization_id')
        .eq('id', existingAuthUser.id)
        .maybeSingle();
      // Só é reaproveitável (descartar + reenviar) quando: (a) é órfã (login
      // sem perfil, sobra de exclusão) OU (b) é um convite pendente DESTA
      // MESMA org (invited_at, nunca logou, perfil aponta pra cá). Conta com
      // perfil em QUALQUER outra situação — inclusive pendente de OUTRA org —
      // não pode ser tocada: apagá-la roubaria/quebraria o cadastro alheio.
      const isPendingHere = Boolean(
        existingAuthUser.invited_at &&
          !existingAuthUser.last_sign_in_at &&
          existingProfile?.organization_id === me.organization_id
      );
      if (existingProfile && !isPendingHere) {
        // Conta já existente: em vez de bloquear, ADICIONA a conta a esta
        // organização — um email pode estar em várias orgs (mesmo comportamento
        // da criação de org pelo superadmin). Não vai email: a pessoa já tem
        // login e senha; a org nova aparece no seletor de organizações dela.
        const { data: existingLink } = await admin
          .from('user_organizations')
          .select('user_id')
          .eq('user_id', existingAuthUser.id)
          .eq('organization_id', me.organization_id)
          .maybeSingle();
        if (existingLink || existingProfile.organization_id === me.organization_id) {
          return json({ error: 'Este email já é membro desta organização.' }, 400);
        }
        const { error: linkError } = await admin.from('user_organizations').upsert(
          {
            user_id: existingAuthUser.id,
            organization_id: me.organization_id,
            role: parsed.data.role as Role,
          },
          { onConflict: 'user_id,organization_id' }
        );
        if (linkError) return json({ error: linkError.message }, 500);
        return json({ addedExisting: true, member: { id: existingAuthUser.id, email } }, 201);
      }
      staleAuthUserId = existingAuthUser.id;
    }
  }

  const { data: invite, error } = await supabase
    .from('organization_invites')
    .insert({
      organization_id: me.organization_id,
      role: parsed.data.role as Role,
      email,
      expires_at: expiresAt,
      created_by: me.id,
    })
    .select('id, token, role, email, created_at, expires_at, used_at, created_by')
    .single();

  if (error) {
    console.error('[admin/invites POST] Database error:', error);
    return json({ error: error.message }, 500);
  }

  let emailSent = false;
  let emailError: string | null = null;
  if (admin && email) {
    if (staleAuthUserId) {
      const { error: delError } = await admin.auth.admin.deleteUser(staleAuthUserId);
      if (delError) {
        emailError = `Não deu pra preparar o email (${delError.message}). Use o link do convite.`;
      }
    }
    if (!emailError) {
      // O email do Supabase leva a pessoa direto pra página do convite
      // (/join?token=...), onde ela define nome e senha. O `data` vira
      // raw_user_meta_data: o trigger handle_new_user cria o perfil já na
      // org certa (sem isso ele cairia no fallback = org mais antiga).
      const origin = req.headers.get('origin') || new URL(req.url).origin;
      const { error: inviteEmailError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/join?token=${invite.token}`,
        data: {
          name: email.split('@')[0],
          organization_id: me.organization_id,
          role: parsed.data.role,
        },
      });
      if (inviteEmailError) {
        emailError = `Convite criado, mas o email não foi enviado (${inviteEmailError.message}). Copie o link e envie direto.`;
      } else {
        emailSent = true;
      }
    }
  }

  console.log('[admin/invites POST] Created invite:', { id: invite?.id, token: invite?.token, expires_at: invite?.expires_at, emailSent });
  return json({ invite, emailSent, emailError }, 201);
}
