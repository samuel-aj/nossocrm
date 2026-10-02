import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgUser } from '@/lib/whatsapp/api';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { getTeamAccess, visibleLead, type EffectiveAccess } from '@/lib/permissions/teamAccessServer';
import { GroupLinksError, type EntityType, type GroupLinkEntity } from './types';

// Match visibleLead in SQL before limiting option results. Values come from trusted team RPC.
export function leadVisibilityFilter(access: EffectiveAccess, userId: string): string | null {
  if (access.fullAccess) return null;
  return access.boards.map(rule => {
    if (rule.scope === 'all') return `board_id.eq.${rule.boardId}`;
    const owners = [...new Set([userId, ...(rule.scope === 'team' ? rule.team ?? [] : [])])];
    return `and(board_id.eq.${rule.boardId},owner_id.in.(${owners.join(',')}))`;
  }).join(',');
}
export async function requireGroupConversationAccess(admin: SupabaseClient, user: OrgUser, id: string): Promise<void> {
  if (!(await conversationAllowed(admin, user, { id }))) throw new GroupLinksError('Grupo indisponível.', 404);
}
export async function visibleEntity(admin: SupabaseClient, user: OrgUser, type: EntityType, id: string, access?: EffectiveAccess): Promise<GroupLinkEntity | null> {
  const team = access ?? await getTeamAccess(admin, user.organizationId, user.id);
  if (type === 'deal') {
    const { data, error } = await admin.from('deals').select('id,title,board_id,owner_id').eq('organization_id', user.organizationId).eq('id', id).is('deleted_at', null).maybeSingle();
    if (error) throw new GroupLinksError('Não foi possível consultar o lead.');
    return data && visibleLead(team, user.id, data.board_id, data.owner_id) ? { id: data.id, name: data.title } : null;
  }
  const { data, error } = await admin.from('contacts').select('id,name').eq('organization_id', user.organizationId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new GroupLinksError('Não foi possível consultar o contato.');
  if (!data) return null;
  if (team.fullAccess) return { id: data.id, name: data.name };
  const filter = leadVisibilityFilter(team, user.id);
  if (!filter) return null;
  const { data: leads, error: leadError } = await admin.from('deals').select('id').eq('organization_id', user.organizationId).eq('contact_id', id).is('deleted_at', null).or(filter).limit(1);
  if (leadError) throw new GroupLinksError('Não foi possível consultar as permissões do contato.');
  return leads?.length ? { id: data.id, name: data.name } : null;
}
