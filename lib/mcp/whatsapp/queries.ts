import 'server-only';
import { connectionAllowed, filterConversationsByOwner, getVisibilityRules } from '@/lib/permissions/server';
import { getWaGroupsEnabled } from '@/lib/whatsapp/service';
import { checkDb, requireDestination, type WhatsAppContext } from './access';

export async function listConnections(ctx: WhatsAppContext) {
  const rules = await getVisibilityRules(ctx.admin, ctx.user.organizationId, ctx.user.id, ctx.user.role);
  const { data, error } = await ctx.admin.from('wa_connections')
    .select('id,organization_id,provider,phone_number,profile_name,status')
    .eq('organization_id', ctx.user.organizationId).order('id');
  checkDb(error);
  return { organizationId: ctx.user.organizationId, connections: (data ?? []).filter(row => connectionAllowed(rules, row.id)) };
}

export async function searchConversations(ctx: WhatsAppContext, input: { name?: string; connectionId?: string; groupsOnly?: boolean; afterId?: string; limit: number }) {
  const { connections } = await listConnections(ctx);
  const allowed = connections.filter(c => !input.connectionId || input.connectionId === c.id);
  if (!allowed.length) return { conversations: [], nextCursor: null };
  let query = ctx.admin.from('wa_conversations')
    .select('id,organization_id,connection_id,contact_id,wa_name,wa_phone,is_group,group_jid,label_ids,last_message_at')
    .eq('organization_id', ctx.user.organizationId).in('connection_id', allowed.map(c => c.id))
    .order('id').limit(input.limit);
  if (input.name) query = query.ilike('wa_name', `%${input.name.replace(/[\\%_]/g, '\\$&')}%`);
  if (input.afterId) query = query.gt('id', input.afterId);
  const groupsEnabled = await getWaGroupsEnabled(ctx.admin, ctx.user.organizationId);
  if (input.groupsOnly && !groupsEnabled) return { conversations: [], nextCursor: null };
  if (input.groupsOnly) query = query.eq('is_group', true);
  else if (!groupsEnabled) query = query.eq('is_group', false);
  const { data, error } = await query;
  checkDb(error);
  const rows = data ?? [];
  const rules = await getVisibilityRules(ctx.admin, ctx.user.organizationId, ctx.user.id, ctx.user.role);
  const labeled = rows.filter(c => !rules?.whatsapp.label_ids || rules.whatsapp.label_ids.some(id => (c.label_ids ?? []).includes(id)));
  const permitted = await filterConversationsByOwner(ctx.admin, ctx.user.organizationId, rules, ctx.user.id, labeled);
  return {
    organizationId: ctx.user.organizationId,
    conversations: permitted.map(c => ({
      id: c.id, name: c.wa_name, phone: c.wa_phone, isGroup: c.is_group, groupId: c.group_jid,
      organizationId: c.organization_id, connectionId: c.connection_id,
      connection: allowed.find(conn => conn.id === c.connection_id), lastMessageAt: c.last_message_at,
    })),
    // Cursor advances through scanned rows even when permissions remove all results.
    nextCursor: rows.length === input.limit ? rows.at(-1)!.id : null,
  };
}

export async function listMessages(ctx: WhatsAppContext, input: { conversationId: string; connectionId: string; before?: { at: string; id: string }; limit: number }) {
  await requireDestination(ctx, input.conversationId, input.connectionId);
  let query = ctx.admin.from('wa_messages')
    .select('id,conversation_id,direction,status,body,evolution_message_id,created_at,media_type,media_mime,sent_by')
    .eq('organization_id', ctx.user.organizationId).eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(input.limit);
  if (input.before) query = query.or(`created_at.lt.${input.before.at},and(created_at.eq.${input.before.at},id.lt.${input.before.id})`);
  const { data, error } = await query;
  checkDb(error);
  const rows = data ?? [];
  const last = rows.at(-1);
  return { conversationId: input.conversationId, connectionId: input.connectionId, messages: rows, nextCursor: rows.length === input.limit && last ? { at: last.created_at, id: last.id } : null };
}
