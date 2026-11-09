import 'server-only';
import type { User } from '@supabase/supabase-js';

/** GoTrue supports a server-side filter; listUsers() in the JS SDK only exposes pagination.
 * The filter can yield partial matches, so always verify the whole address.
 * An Auth error must never be interpreted as an available email.
 */
export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const target = email.trim().toLowerCase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Auth admin indisponível.');
  const url = new URL('/auth/v1/admin/users', process.env.NEXT_PUBLIC_SUPABASE_URL);
  url.searchParams.set('filter', target);
  url.searchParams.set('per_page', '100');
  for (let page = 1; page <= 20; page++) {
    url.searchParams.set('page', String(page));
    const response = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Não foi possível consultar o e-mail no Auth.');
    const { users } = await response.json() as { users?: User[] };
    if (!Array.isArray(users)) throw new Error('Resposta inválida do Auth.');
    const found = users.find(u => u.email?.toLowerCase() === target);
    if (found) return found;
    if (users.length < 100) return null;
  }
  throw new Error('A verificação do e-mail não foi concluída.');
}
