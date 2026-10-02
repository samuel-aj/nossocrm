import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GroupLinksError } from './types';

export async function getGroupLinksEnabled(admin: SupabaseClient, organizationId: string): Promise<boolean> {
  const { data, error } = await admin.from('organization_settings').select('wa_group_links_enabled').eq('organization_id', organizationId).maybeSingle();
  if (error) throw new GroupLinksError('Não foi possível consultar a configuração de vínculos.');
  return data?.wa_group_links_enabled === true;
}
export async function setGroupLinksEnabled(admin: SupabaseClient, organizationId: string, enabled: boolean): Promise<void> {
  const { error } = await admin.from('organization_settings').upsert({ organization_id: organizationId, wa_group_links_enabled: enabled }, { onConflict: 'organization_id' });
  if (error) throw new GroupLinksError('Não foi possível salvar a configuração de vínculos.');
}
