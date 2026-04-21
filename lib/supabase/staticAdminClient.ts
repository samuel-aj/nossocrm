import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _instance: SupabaseClient | null = null;

/**
 * Static admin client (service role) for non-Next runtimes.
 *
 * - Não depende de `next/headers` nem de `server-only`
 * - Seguro para uso em scripts/CLI e em agentes (sem cookies)
 * - Singleton: reutiliza a mesma conexão entre chamadas
 */
export function createStaticAdminClient() {
  if (_instance) return _instance;
  _instance = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  return _instance;
}
