import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { findAuthUserByEmail } from '@/lib/supabase/authUsers';
import { UserRole } from '@/types/constants';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

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

  // Performance: evita payload grande em organizações com muitos usuários.
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, role, organization_id, created_at, first_name, last_name, nickname')
    .eq('organization_id', me.organization_id)
    .limit(200)
    .order('created_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);

  const users = (profiles || []).map((p) => ({
    id: p.id,
    email: p.email,
    role: p.role,
    organization_id: p.organization_id,
    created_at: p.created_at,
    first_name: p.first_name ?? null,
    last_name: p.last_name ?? null,
    nickname: p.nickname ?? null,
    status: 'active' as const,
  }));

  return json({ users });
}

const CreateUserSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
    role: z.enum([UserRole.ADMIN, UserRole.VENDEDOR]).default(UserRole.VENDEDOR),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

/**
 * POST /api/admin/users — Criação direta de usuário pelo admin da org:
 * email + senha prontos, sem convite (o admin passa o login pra pessoa).
 * Email com conta ativa em outra org NÃO é aceito aqui (senha de terceiros
 * nunca é alterada); nesse caso o caminho é o convite por link.
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
  const parsed = CreateUserSchema.safeParse(raw);
  if (!parsed.success) {
    const firstMsg = parsed.error.issues[0]?.message || 'Dados inválidos';
    return json({ error: firstMsg, details: parsed.error.flatten() }, 400);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { password, role } = parsed.data;
  const displayName = parsed.data.name?.trim() || email.split('@')[0];

  const admin = createStaticAdminClient();

  // Limite de usuários da organização (mesmo número exibido no Super Admin).
  const [{ data: org }, { count: memberCount }] = await Promise.all([
    admin.from('organizations').select('max_users').eq('id', me.organization_id).single(),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', me.organization_id),
  ]);
  if (org?.max_users && (memberCount ?? 0) >= org.max_users) {
    return json(
      { error: `Limite de ${org.max_users} usuário(s) da organização atingido. Fale com o suporte pra aumentar.` },
      400
    );
  }

  const userMetadata = { name: displayName, organization_id: me.organization_id, role };

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
        { error: 'Este email já tem uma conta ativa no CRM. Use o convite (link ou email) ou outro email.' },
        400
      );
    }

    // Login órfão (sobra de exclusão): reaproveita com a senha nova.
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

  const { error: profileError } = await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      name: displayName,
      first_name: displayName,
      organization_id: me.organization_id,
      role,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    // Rollback apenas da conta que ESTE fluxo criou.
    if (!existingAuthUser) {
      await admin.auth.admin.deleteUser(userId);
    }
    return json({ error: profileError.message }, 400);
  }

  await admin.from('user_organizations').upsert(
    {
      user_id: userId,
      organization_id: me.organization_id,
      role,
    },
    { onConflict: 'user_id,organization_id' }
  );

  return json({ ok: true, user: { id: userId, email, role } }, 201);
}
