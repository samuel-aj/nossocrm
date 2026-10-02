import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: vi.fn(), team: vi.fn() }));
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: m.allowed }));
vi.mock('@/lib/permissions/teamAccessServer', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/permissions/teamAccessServer')>(), getTeamAccess: m.team }));
import { testClient } from './testClient';
import { getGroupLinks, getGroupLinkOptions } from './reads';
import { getKnownGroup, mutateGroupLink } from './service';
import { visibleEntity, leadVisibilityFilter } from './access';
import type { EffectiveAccess } from '@/lib/permissions/teamAccessServer';
const user = { id: 'user', organizationId: 'org', role: 'sales' };
const full: EffectiveAccess = { fullAccess: true, canManage: false, masterUserId: null, legacy: false, boards: [] };
const own: EffectiveAccess = { ...full, fullAccess: false, boards: [{ boardId: 'board', scope: 'own' }] };
const jid = '120363012345678901@g.us';
function db(enabled = true) {
  return testClient({
    organization_settings: [{ organization_id: 'org', wa_group_links_enabled: enabled }],
    wa_connections: [{ id: 'conn', organization_id: 'org', provider: 'evolution' }],
    wa_conversations: [{ id: 'conv', organization_id: 'org', connection_id: 'conn', is_group: true, group_jid: jid, wa_phone: jid, wa_name: 'Renamed group' }],
    wa_group_entities: [{ id: 'group', organization_id: 'org', provider: 'evolution', external_id: jid }],
    wa_group_contact_links: [{ organization_id: 'org', group_id: 'group', contact_id: 'contact' }],
    wa_group_deal_links: [{ organization_id: 'org', group_id: 'group', deal_id: 'deal', is_primary: true }],
    contacts: [{ id: 'contact', organization_id: 'org', name: 'Ana', deleted_at: null }],
    deals: [{ id: 'deal', organization_id: 'org', title: 'Sales', board_id: 'board', owner_id: 'user', contact_id: 'contact', deleted_at: null }],
  });
}
beforeEach(() => { vi.clearAllMocks(); m.allowed.mockResolvedValue(true); m.team.mockResolvedValue(full); });
describe('reads and visibility', () => {
  it('disabled response has no group field and does not query links or permissions', async () => {
    const d = db(false);
    expect(await getGroupLinks(d.admin, user, { dealId: 'deal' })).toEqual({ enabled: false, groups: [], contacts: [], deals: [] });
    expect(d.queries.map(q => q.table)).toEqual(['organization_settings']);
    expect(m.team).not.toHaveBeenCalled();
  });
  it('resolves current visible conversation name and full JID, never registry snapshots', async () => {
    const d = db();
    expect(await getGroupLinks(d.admin, user, { dealId: 'deal' })).toEqual({ enabled: true, contacts: [], deals: [], whatsappGroupId: jid, groups: [{ id: 'group', provider: 'evolution', externalId: jid, name: 'Renamed group', conversationId: 'conv', isPrimary: true }] });
    expect(m.allowed).toHaveBeenCalledWith(d.admin, user, { id: 'conv' });
  });
  it('does not leak hidden group ID/name or primary JID', async () => {
    m.allowed.mockResolvedValue(false);
    expect(await getGroupLinks(db().admin, user, { dealId: 'deal' })).toEqual({ enabled: true, contacts: [], deals: [], groups: [], whatsappGroupId: null });
  });
  it('finds shared canonical links from a group conversation', async () => {
    expect(await getGroupLinks(db().admin, user, { conversationId: 'conv' })).toEqual({ enabled: true, groups: [], contacts: [{ id: 'contact', name: 'Ana' }], deals: [{ id: 'deal', name: 'Sales' }] });
  });
  it('rejects inaccessible entities and org mismatch', async () => {
    m.team.mockResolvedValue({ ...own, boards: [] });
    await expect(getGroupLinks(db().admin, user, { dealId: 'deal' })).rejects.toMatchObject({ status: 404 });
    m.team.mockResolvedValue(full);
    await expect(getGroupLinks(db().admin, { ...user, organizationId: 'other' }, { dealId: 'deal' })).resolves.toMatchObject({ enabled: false });
    await expect(getKnownGroup(db().admin, { ...user, organizationId: 'other' }, 'conv')).rejects.toMatchObject({ status: 404 });
  });
  it('contacts without visible leads require full access', async () => {
    const d = testClient({ contacts: [{ id: 'contact', name: 'Ana', organization_id: 'org' }], deals: [] });
    expect(await visibleEntity(d.admin, user, 'contact', 'contact', full)).toEqual({ id: 'contact', name: 'Ana' });
    expect(await visibleEntity(d.admin, user, 'contact', 'contact', own)).toBeNull();
    expect(d.queries.find(q => q.table === 'deals')?.calls).toContainEqual(['or', 'and(board_id.eq.board,owner_id.in.(user))', undefined]);
  });
  it('lead restrictions match all/own/team board permissions', () => {
    expect(leadVisibilityFilter({ ...own, boards: [{ boardId: 'all', scope: 'all' }, { boardId: 'own', scope: 'own' }, { boardId: 'team', scope: 'team', team: ['peer', 'user'] }] }, user.id)).toBe('board_id.eq.all,and(board_id.eq.own,owner_id.in.(user)),and(board_id.eq.team,owner_id.in.(user,peer))');
  });
  it('fail closed on lookup errors', async () => {
    const d = db(); d.failures.wa_group_entities = { message: 'secret' };
    await expect(getGroupLinks(d.admin, user, { dealId: 'deal' })).rejects.toThrow('Não foi possível');
  });
});
describe('delta writes', () => {
  it.each(['link', 'unlink', 'set_primary'] as const)('uses scoped RPC for %s', async action => {
    const d = db();
    await mutateGroupLink(d.admin, user, { conversationId: 'conv', entityType: 'deal', entityId: 'deal', action });
    expect(d.rpc).toHaveBeenCalledWith('mutate_whatsapp_group_link', { p_organization_id: 'org', p_conversation_id: 'conv', p_entity_type: 'deal', p_entity_id: 'deal', p_action: action });
    expect(d.queries.every(q => q.calls.every(c => c[0] !== 'upsert'))).toBe(true);
  });
  it('rejects disabled writes without touching registry', async () => {
    const d = db(false);
    await expect(mutateGroupLink(d.admin, user, { conversationId: 'conv', entityType: 'deal', entityId: 'deal', action: 'link' })).rejects.toMatchObject({ status: 409 });
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it('requires both sides visible', async () => {
    const d = db(); m.allowed.mockResolvedValue(false);
    await expect(mutateGroupLink(d.admin, user, { conversationId: 'conv', entityType: 'deal', entityId: 'deal', action: 'set_primary' })).rejects.toMatchObject({ status: 404 });
    m.allowed.mockResolvedValue(true); m.team.mockResolvedValue({ ...own, boards: [] });
    await expect(mutateGroupLink(d.admin, user, { conversationId: 'conv', entityType: 'deal', entityId: 'deal', action: 'set_primary' })).rejects.toMatchObject({ status: 404 });
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it('handles disable races in the atomic RPC', async () => {
    const d = db(); d.rpc.mockResolvedValue({ data: null, error: { code: '55000' } });
    await expect(mutateGroupLink(d.admin, user, { conversationId: 'conv', entityType: 'deal', entityId: 'deal', action: 'link' })).rejects.toMatchObject({ status: 409 });
  });
});
describe('options', () => {
  it('bounds and searches visible deals by title', async () => {
    const d = db(); m.team.mockResolvedValue(own);
    expect(await getGroupLinkOptions(d.admin, user, 'conv', 'deal', 'Sal')).toEqual([{ id: 'deal', name: 'Sales' }]);
    const q = d.queries.find(q => q.table === 'deals');
    expect(q?.calls).toContainEqual(['ilike', 'title', '%Sal%']);
    expect(q?.calls).toContainEqual(['or', 'and(board_id.eq.board,owner_id.in.(user))', undefined]);
    expect(q?.calls).toContainEqual(['limit', 50]);
  });
  it('restricts contact parents through an inner join before limiting', async () => {
    const d = db(); m.team.mockResolvedValue(own);
    await getGroupLinkOptions(d.admin, user, 'conv', 'contact', 'Ana');
    const q = d.queries.find(q => q.table === 'contacts');
    expect(q?.calls).toContainEqual(['select', 'id,name,deals!inner(id)']);
    expect(q?.calls).toContainEqual(['eq', 'deals.organization_id', 'org']);
    expect(q?.calls).toContainEqual(['or', 'and(board_id.eq.board,owner_id.in.(user))', { referencedTable: 'deals' }]);
    expect(q?.calls).toContainEqual(['limit', 50]);
  });
  it('disabled options do not query hidden entities', async () => {
    const d = db(false); expect(await getGroupLinkOptions(d.admin, user, 'conv', 'contact', '')).toEqual([]);
    expect(d.queries).toHaveLength(1);
  });
});

describe('additional access and pagination cases', () => {
  it('resolves the same group through another visible connection', async () => {
    const d = db();
    d.tables.wa_connections.push({ id: 'conn2', organization_id: 'org', provider: 'evolution' });
    d.tables.wa_conversations.push({ id: 'conv2', organization_id: 'org', connection_id: 'conn2', is_group: true, group_jid: jid, wa_phone: jid, wa_name: 'Visible name' });
    m.allowed.mockImplementation(async (_admin, _user, target: { id: string }) => target.id === 'conv2');
    const result = await getGroupLinks(d.admin, user, { dealId: 'deal' });
    expect(result.groups[0]).toMatchObject({ conversationId: 'conv2', name: 'Visible name', externalId: jid });
  });
  it('omits hidden linked entities from a visible group', async () => {
    const d = db();
    m.team.mockResolvedValue({ ...own, boards: [] });
    expect(await getGroupLinks(d.admin, user, { conversationId: 'conv' })).toEqual({ enabled: true, groups: [], contacts: [], deals: [] });
  });
  it('rejects entity org mismatch even with full access', async () => {
    const d = db();
    expect(await visibleEntity(d.admin, { ...user, organizationId: 'other' }, 'deal', 'deal', full)).toBeNull();
    expect(await visibleEntity(d.admin, { ...user, organizationId: 'other' }, 'contact', 'contact', full)).toBeNull();
  });
  it.each(['@g.us', '', '123@s.whatsapp.net', ' 123@g.us'])('does not register malformed known JID %s', async externalId => {
    const d = db(); d.tables.wa_conversations[0].group_jid = externalId;
    await expect(mutateGroupLink(d.admin, user, { conversationId: 'conv', entityType: 'deal', entityId: 'deal', action: 'link' })).rejects.toMatchObject({ status: 404 });
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it('cannot register a private conversation', async () => {
    const d = db(); d.tables.wa_conversations[0].is_group = false;
    await expect(getKnownGroup(d.admin, user, 'conv')).rejects.toMatchObject({ status: 404 });
  });
  it('does not show options when conversation is inaccessible', async () => {
    const d = db(); m.allowed.mockResolvedValue(false);
    await expect(getGroupLinkOptions(d.admin, user, 'conv', 'deal', '')).rejects.toMatchObject({ status: 404 });
    expect(d.queries.some(q => q.table === 'deals')).toBe(false);
  });
  it('returns at most 50 title matches', async () => {
    const d = db(); d.tables.deals = Array.from({ length: 60 }, (_, i) => ({ id: `deal${i}`, title: `Sales ${i}`, organization_id: 'org', deleted_at: null }));
    expect(await getGroupLinkOptions(d.admin, user, 'conv', 'deal', 'Sales')).toHaveLength(50);
  });
  it('pages linked entities beyond the first 100 rows', async () => {
    const d = db();
    d.tables.contacts = Array.from({ length: 101 }, (_, i) => ({ id: `contact${i}`, name: `Ana ${i}`, organization_id: 'org', deleted_at: null }));
    d.tables.wa_group_contact_links = d.tables.contacts.map(c => ({ organization_id: 'org', group_id: 'group', contact_id: c.id }));
    const result = await getGroupLinks(d.admin, user, { conversationId: 'conv' });
    expect(result.contacts).toHaveLength(101);
    expect(d.queries.filter(q => q.table === 'wa_group_contact_links')[1].calls).toContainEqual(['range', 100, 199]);
  });
});
