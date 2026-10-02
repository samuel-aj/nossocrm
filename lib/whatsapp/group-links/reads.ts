import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgUser } from '@/lib/whatsapp/api';
import { getTeamAccess } from '@/lib/permissions/teamAccessServer';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { visibleEntity, leadVisibilityFilter } from './access';
import { getKnownGroup } from './service';
import { getGroupLinksEnabled } from './settings';
import { emptyGroupLinks, GroupLinksError, type EntityType, type GroupLinkEntity, type GroupLinksResponse, type GroupLinksTarget, type RelatedGroup } from './types';

// Page every relationship query to avoid Supabase's default row cap silently hiding links.
async function readPages<T>(read: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const result: T[] = [];
  for (let start = 0; start < 10000; start += 100) {
    const { data, error } = await read(start, start + 99);
    if (error) throw new GroupLinksError('Não foi possível consultar os vínculos de grupos.');
    const page = data ?? [];
    result.push(...page);
    if (page.length < 100) return result;
  }
  throw new GroupLinksError('Há muitos vínculos para esta consulta.', 422);
}
type RegistryGroup = { id: string; provider: string; external_id: string };
async function visibleGroup(admin: SupabaseClient, user: OrgUser, group: RegistryGroup, isPrimary: boolean): Promise<RelatedGroup | null> {
  const connections = await readPages<{ id: string }>((start, end) => admin.from('wa_connections').select('id').eq('organization_id', user.organizationId).eq('provider', group.provider).order('id').range(start, end));
  if (!connections.length) return null;
  // Separate equality queries keep provider IDs literal, even when they contain filter punctuation.
  for (let offset = 0; offset < connections.length; offset += 100) {
    const ids = connections.slice(offset, offset + 100).map(c => c.id);
    for (const fallback of [false, true]) {
      const conversations = await readPages<{ id: string; wa_name: string | null }>((start, end) => {
        let query = admin.from('wa_conversations').select('id,wa_name').eq('organization_id', user.organizationId).eq('is_group', true).in('connection_id', ids);
        query = fallback ? query.is('group_jid', null).eq('wa_phone', group.external_id) : query.eq('group_jid', group.external_id);
        return query.order('id').range(start, end);
      });
      for (const conversation of conversations) {
        if (await conversationAllowed(admin, user, { id: conversation.id })) {
          return { id: group.id, provider: group.provider, externalId: group.external_id, name: conversation.wa_name || 'Grupo do WhatsApp', conversationId: conversation.id, isPrimary };
        }
      }
    }
  }
  return null;
}
export async function getGroupLinks(admin: SupabaseClient, user: OrgUser, target: GroupLinksTarget): Promise<GroupLinksResponse> {
  if (!(await getGroupLinksEnabled(admin, user.organizationId))) return emptyGroupLinks();
  const response: GroupLinksResponse = { enabled: true, groups: [], contacts: [], deals: [] };
  const org = user.organizationId;
  const access = await getTeamAccess(admin, org, user.id);
  if ('conversationId' in target) {
    const known = await getKnownGroup(admin, user, target.conversationId);
    const { data: group, error } = await admin.from('wa_group_entities').select('id').eq('organization_id', org).eq('provider', known.provider).eq('external_id', known.externalId).maybeSingle();
    if (error) throw new GroupLinksError('Não foi possível consultar o grupo.');
    if (!group) return response;
    const contacts = await readPages<{ contact_id: string }>((start, end) => admin.from('wa_group_contact_links').select('contact_id').eq('organization_id', org).eq('group_id', group.id).order('contact_id').range(start, end));
    const deals = await readPages<{ deal_id: string }>((start, end) => admin.from('wa_group_deal_links').select('deal_id').eq('organization_id', org).eq('group_id', group.id).order('deal_id').range(start, end));
    for (const link of contacts) { const entity = await visibleEntity(admin, user, 'contact', link.contact_id, access); if (entity) response.contacts.push(entity); }
    for (const link of deals) { const entity = await visibleEntity(admin, user, 'deal', link.deal_id, access); if (entity) response.deals.push(entity); }
    return response;
  }
  const type = 'dealId' in target ? 'deal' : 'contact';
  const id = 'dealId' in target ? target.dealId : target.contactId;
  if (!(await visibleEntity(admin, user, type, id, access))) throw new GroupLinksError('Contato ou lead indisponível.', 404);
  const links = await readPages<{ group_id: string; is_primary?: boolean }>((start, end) => type === 'deal'
    ? admin.from('wa_group_deal_links').select('group_id,is_primary').eq('organization_id', org).eq('deal_id', id).order('group_id').range(start, end)
    : admin.from('wa_group_contact_links').select('group_id').eq('organization_id', org).eq('contact_id', id).order('group_id').range(start, end));
  for (const link of links) {
    const { data: group, error } = await admin.from('wa_group_entities').select('id,provider,external_id').eq('organization_id', org).eq('id', link.group_id).maybeSingle();
    if (error) throw new GroupLinksError('Não foi possível consultar o grupo.');
    if (!group) continue;
    const visible = await visibleGroup(admin, user, group, link.is_primary === true);
    if (visible) response.groups.push(visible);
  }
  if (type === 'deal') response.whatsappGroupId = response.groups.find(g => g.isPrimary)?.externalId ?? null;
  return response;
}
export async function getGroupLinkOptions(admin: SupabaseClient, user: OrgUser, conversationId: string, type: EntityType, search: string): Promise<GroupLinkEntity[]> {
  if (!(await getGroupLinksEnabled(admin, user.organizationId))) return [];
  await getKnownGroup(admin, user, conversationId);
  const access = await getTeamAccess(admin, user.organizationId, user.id);
  const filter = leadVisibilityFilter(access, user.id);
  if (filter === '') return [];
  const term = `%${search.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  if (type === 'deal') {
    let query = admin.from('deals').select('id,title').eq('organization_id', user.organizationId).is('deleted_at', null).ilike('title', term);
    if (filter) query = query.or(filter);
    const { data, error } = await query.order('title').order('id').limit(50);
    if (error) throw new GroupLinksError('Não foi possível consultar os leads.');
    return (data ?? []).map(d => ({ id: d.id, name: d.title }));
  }
  if (access.fullAccess) {
    const { data, error } = await admin.from('contacts').select('id,name').eq('organization_id', user.organizationId).is('deleted_at', null).ilike('name', term).order('name').order('id').limit(50);
    if (error) throw new GroupLinksError('Não foi possível consultar os contatos.');
    return (data ?? []).map(c => ({ id: c.id, name: c.name }));
  }
  let query = admin.from('contacts').select('id,name,deals!inner(id)').eq('organization_id', user.organizationId).is('deleted_at', null).ilike('name', term);
  if (filter) query = query.eq('deals.organization_id', user.organizationId).is('deals.deleted_at', null).or(filter, { referencedTable: 'deals' });
  const { data, error } = await query.order('name').order('id').limit(50);
  if (error) throw new GroupLinksError('Não foi possível consultar os contatos.');
  return (data ?? []).map(c => ({ id: c.id, name: c.name }));
}
