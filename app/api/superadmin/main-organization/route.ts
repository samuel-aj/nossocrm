import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { json } from '@/lib/whatsapp/api';
import { UserRole } from '@/types/constants';
import { isValidUUID } from '@/lib/supabase/utils';

export const dynamic = 'force-dynamic';

/** The home destination is configuration, independent of the active org or its name. */
export async function GET() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return json({ error: 'Não autorizado' }, 401);
  const { data: profile, error: profileError } = await client.from('profiles').select('role').eq('id', user.id).single();
  if (profileError || profile?.role !== UserRole.SUPER_ADMIN) return json({ error: 'Acesso restrito ao superadmin' }, 403);
  const admin = createStaticAdminClient();
  const { data: config, error } = await admin.from('platform_config').select('value').eq('key', 'main_organization_id').maybeSingle();
  if (error) return json({ error: 'Falha ao consultar a conta principal' }, 500);
  if (!config?.value || !isValidUUID(config.value)) return json({ organization: null });
  const { data: organization, error: orgError } = await admin.from('organizations').select('id,name').eq('id', config.value).is('deleted_at', null).eq('is_active', true).maybeSingle();
  if (orgError) return json({ error: 'Falha ao consultar a conta principal' }, 500);
  return json({ organization });
}
