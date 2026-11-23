import type { SupabaseClient } from '@supabase/supabase-js';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import type { BoardAccess } from './teamRoles';
import { createShortCache } from '@/lib/server/shortCache';
export interface EffectiveAccess {
  fullAccess: boolean; canManage: boolean; masterUserId: string | null; legacy: boolean;
  boards: Array<Omit<BoardAccess, 'scope'> & { scope: 'own' | 'all' | 'team'; team?: string[] }>;
}
/**
 * Toda rota confere as permissões; guardar 10 s por usuário tirou dezenas de
 * milhares de consultas por hora do banco (23/11/2026). Mudança de papel vale
 * na hora nesta instância (forgetTeamAccess) e em até 10 s nas demais.
 */
const teamAccessCache = createShortCache<EffectiveAccess>(10_000);
export function forgetTeamAccess(org?: string): void {
  teamAccessCache.forget(org ? `${org}:` : undefined);
}
export async function getTeamAccess(admin: SupabaseClient, org: string, user: string): Promise<EffectiveAccess> {
  return teamAccessCache.get(`${org}:${user}`, async () => {
    const { data, error } = await admin.rpc('team_effective_access', { p_org: org, p_user: user });
    if (error || !data) throw new Error('Não foi possível consultar as permissões da equipe');
    return data as EffectiveAccess;
  });
}
export async function canManageTeam(me: { id: string; organization_id: string }): Promise<boolean> {
  return (await getTeamAccess(createStaticAdminClient(), me.organization_id, me.id)).canManage;
}
export function visibleLead(access: EffectiveAccess, user: string, board: string | null, owner: string | null): boolean {
  if (access.fullAccess) return true;
  const rule = access.boards.find(b => b.boardId === board);
  return !!rule && (rule.scope === 'all' || owner === user || (rule.scope === 'team' && !!owner && !!rule.team?.includes(owner)));
}
