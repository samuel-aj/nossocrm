import type { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * Procura uma conta de login (auth) pelo email. A API admin não tem busca
 * direta por email, então pagina o listUsers (limite alto o bastante para
 * a base atual; para na primeira página incompleta).
 */
export async function findAuthUserByEmail(
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
