import { supabase } from './client';
import type { Profile } from '@/context/AuthContext';
import type { TabOrg } from '@/lib/tabOrg';
import type { OrganizationId } from '@/types';

/** Resolve o perfil inteiro antes de publicá-lo. Não altera o pin nem o estado React. */
export async function loadAuthProfile(userId: string, pinned: TabOrg | null, signal: AbortSignal) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, organizations!profiles_organization_id_fkey(name)')
    .eq('id', userId)
    .abortSignal(signal)
    .single();
  if (error) throw error;
  if (!data || data.id !== userId) throw new Error('Perfil não encontrado para esta sessão.');

  const org = data.organizations as { name: string } | null;
  const base: Profile = { ...data, organization_name: org?.name ?? null, organizations: undefined } as Profile;
  if (!pinned || pinned.id === base.organization_id) return base;

  if (base.role === 'super_admin') {
    const { data: pinnedOrg, error: orgError } = await supabase
      .from('organizations').select('name').eq('id', pinned.id).abortSignal(signal).maybeSingle();
    if (orgError) throw orgError;
    return {
      ...base,
      organization_id: pinned.id as OrganizationId,
      organization_name: (pinnedOrg as { name?: string } | null)?.name ?? pinned.name,
    };
  }

  const { data: link, error: linkError } = await supabase
    .from('user_organizations')
    .select('role, organizations!user_organizations_organization_id_fkey(name)')
    .eq('user_id', base.id).eq('organization_id', pinned.id).abortSignal(signal).maybeSingle();
  // Erro de rede não confirma remoção do vínculo nem permite assumir o papel da org padrão.
  if (linkError) throw linkError;
  if (!link) return base;
  const linkOrg = link.organizations as { name?: string } | null;
  return {
    ...base,
    organization_id: pinned.id as OrganizationId,
    organization_name: linkOrg?.name || pinned.name,
    role: (link.role as Profile['role']) || base.role,
  };
}
