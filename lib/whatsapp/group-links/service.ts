import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgUser } from '@/lib/whatsapp/api';
import { requireGroupConversationAccess, visibleEntity } from './access';
import { getGroupLinksEnabled } from './settings';
import { GroupLinksError, type EntityType, type GroupLinkField, type LinkAction } from './types';

export function isGroupExternalId(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && /^[^\s@]+@g\.us$/.test(value);
}
/** Only for trusted server webhook code. The RPC reads setting and principal together. */
export async function getDealWhatsappGroupField(admin: SupabaseClient, organizationId: string, dealId: string): Promise<GroupLinkField> {
  const { data, error } = await admin.rpc('deal_whatsapp_group_field', { p_organization_id: organizationId, p_deal_id: dealId });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new GroupLinksError('Não foi possível consultar o ID do grupo.');
  const keys = Object.keys(data);
  if (!keys.length) return {};
  if (keys.length !== 1 || keys[0] !== 'whatsapp_group_id' || (data.whatsapp_group_id !== null && !isGroupExternalId(data.whatsapp_group_id))) {
    throw new GroupLinksError('Não foi possível consultar o ID do grupo.');
  }
  return { whatsapp_group_id: data.whatsapp_group_id };
}
export type KnownGroup = { conversationId: string; provider: string; externalId: string; name: string };
export async function getKnownGroup(admin: SupabaseClient, user: OrgUser, conversationId: string): Promise<KnownGroup> {
  await requireGroupConversationAccess(admin, user, conversationId);
  const { data: conversation, error } = await admin.from('wa_conversations').select('id,connection_id,is_group,group_jid,wa_phone,wa_name')
    .eq('organization_id', user.organizationId).eq('id', conversationId).eq('is_group', true).maybeSingle();
  if (error) throw new GroupLinksError('Não foi possível consultar o grupo.');
  const externalId = conversation?.group_jid ?? conversation?.wa_phone;
  if (!conversation?.connection_id || !isGroupExternalId(externalId)) throw new GroupLinksError('Grupo indisponível.', 404);
  const { data: connection, error: connectionError } = await admin.from('wa_connections').select('provider').eq('organization_id', user.organizationId).eq('id', conversation.connection_id).maybeSingle();
  if (connectionError) throw new GroupLinksError('Não foi possível consultar a conexão do grupo.');
  if (!connection?.provider || connection.provider !== connection.provider.trim()) throw new GroupLinksError('Grupo indisponível.', 404);
  return { conversationId, provider: connection.provider, externalId, name: conversation.wa_name || 'Grupo do WhatsApp' };
}
export async function mutateGroupLink(admin: SupabaseClient, user: OrgUser, input: { conversationId: string; entityType: EntityType; entityId: string; action: LinkAction }): Promise<void> {
  if (!(await getGroupLinksEnabled(admin, user.organizationId))) throw new GroupLinksError('Vínculos de grupos estão desativados.', 409);
  await getKnownGroup(admin, user, input.conversationId);
  if (!(await visibleEntity(admin, user, input.entityType, input.entityId))) throw new GroupLinksError('Contato ou lead indisponível.', 404);
  const { error } = await admin.rpc('mutate_whatsapp_group_link', {
    p_organization_id: user.organizationId, p_conversation_id: input.conversationId,
    p_entity_type: input.entityType, p_entity_id: input.entityId, p_action: input.action,
  });
  if (error) {
    if (error.code === '55000') throw new GroupLinksError('Vínculos de grupos estão desativados.', 409);
    if (error.code === '22023') throw new GroupLinksError('Vínculo indisponível; atualize e tente novamente.', 409);
    throw new GroupLinksError('Não foi possível alterar o vínculo do grupo.');
  }
}
