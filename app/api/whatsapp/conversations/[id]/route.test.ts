import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), allowed: vi.fn(), team: vi.fn(), visible: vi.fn(), rpc: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), responses: {} as Record<string, unknown> }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: m.allowed }));
vi.mock('@/lib/permissions/teamAccessServer', () => ({ getTeamAccess: m.team, visibleLead: m.visible }));
import { PATCH } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const label = '22222222-2222-4222-8222-222222222222';
const req = (body: unknown) => new Request('https://crm.test/api/whatsapp/conversations/'+id, { method: 'PATCH', body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  m.responses = { wa_labels: { data: [{ id: label }], error: null }, wa_conversations: { data: { id, contact_id: 'contact', is_group: false }, error: null }, deals: { data: { id, contact_id: 'contact', board_id: 'board', owner_id: 'owner' }, error: null } };
  m.from.mockImplementation(table => {
    const q: Record<string, unknown> = {};
    let writing = false;
    for (const key of ['select', 'is', 'in']) q[key] = vi.fn(() => q);
    q.eq = (...args: unknown[]) => { m.eq(...args); return q; };
    q.update = (...args: unknown[]) => { writing = true; m.update(...args); return q; };
    q.maybeSingle = () => Promise.resolve(writing && m.responses[table + '_write'] ? m.responses[table + '_write'] : m.responses[table]);
    q.then = (resolve: (value: unknown) => void) => Promise.resolve(m.responses[table]).then(resolve);
    return q;
  });
  m.auth.mockResolvedValue({ ok: true, user: { id: 'user', organizationId: 'org' }, admin: { from: m.from, rpc: m.rpc } });
  m.allowed.mockResolvedValue(true); m.team.mockResolvedValue({ fullAccess: true }); m.visible.mockReturnValue(true);
  m.rpc.mockResolvedValue({ data: { id, label_ids: [label], deal_id: null }, error: null });
});
describe('conversation labels and explicit linking', () => {
  it('rejects inaccessible conversations before writing', async () => {
    m.allowed.mockResolvedValue(false); expect((await PATCH(req({ labelIds: [] }), ctx)).status).toBe(404); expect(m.update).not.toHaveBeenCalled();
  });
  it('uses organization-scoped atomic RPC for deltas', async () => {
    expect((await PATCH(req({ addLabelIds: [label] }), ctx)).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('mutate_conversation_labels', { p_org: 'org', p_conversation: id, p_add: [label], p_remove: [], p_expected_deal: null, p_check_link: true });
    expect(m.eq).toHaveBeenCalledWith('organization_id', 'org');
  });
  it('rejects foreign or removed catalog IDs instead of dropping them', async () => {
    m.responses.wa_labels = { data: [], error: null };
    expect((await PATCH(req({ labelIds: [label] }), ctx)).status).toBe(400); expect(m.update).not.toHaveBeenCalled();
  });
  it('links only an explicitly selected visible lead of this contact', async () => {
    expect((await PATCH(req({ dealId: id }), ctx)).status).toBe(200);
    expect(m.visible).toHaveBeenCalledWith({ fullAccess: true }, 'user', 'board', 'owner');
    expect(m.update).toHaveBeenCalledWith({ deal_id: id });
  });
  it('rejects a different contact, hidden lead and group', async () => {
    m.responses.deals = { data: { id, contact_id: 'other' }, error: null };
    expect((await PATCH(req({ dealId: id }), ctx)).status).toBe(404);
    m.responses.deals = { data: { id, contact_id: 'contact' }, error: null }; m.visible.mockReturnValue(false);
    expect((await PATCH(req({ dealId: id }), ctx)).status).toBe(404);
    m.responses.wa_conversations = { data: { is_group: true }, error: null };
    expect((await PATCH(req({ dealId: id }), ctx)).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });
  it.each([{ labelIds: [label] }, { addLabelIds: [label] }])('rejects label edits reaching a hidden persisted lead: %j', async body => {
    // The contact's visible lead A allows reading the conversation, but its link is B.
    m.allowed.mockResolvedValue(true);
    m.responses.wa_conversations = { data: { id, contact_id: 'contact', is_group: false, deal_id: 'hidden-B' }, error: null };
    m.responses.deals = { data: { id: 'hidden-B', contact_id: 'contact', board_id: 'hidden-board', owner_id: 'other-user' }, error: null };
    m.team.mockResolvedValue({ fullAccess: false, boards: [{ boardId: 'visible-board', scope: 'all' }] });
    m.visible.mockImplementation((_access, _user, board) => board === 'visible-board');
    expect((await PATCH(req(body), ctx)).status).toBe(404);
    expect(m.eq).toHaveBeenCalledWith('id', 'hidden-B');
    expect(m.visible).toHaveBeenCalledWith(expect.objectContaining({ fullAccess: false }), 'user', 'hidden-board', 'other-user');
    expect(m.update).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([{ labelIds: [label] }, { addLabelIds: [label] }])('allows label edits on the visible persisted lead: %j', async body => {
    m.responses.wa_conversations = { data: { id, contact_id: 'contact', is_group: false, deal_id: 'visible-A' }, error: null };
    m.responses.deals = { data: { id: 'visible-A', contact_id: 'contact', board_id: 'visible-board', owner_id: 'user' }, error: null };
    m.team.mockResolvedValue({ fullAccess: false, boards: [{ boardId: 'visible-board', scope: 'all' }] });
    m.visible.mockImplementation((_access, _user, board) => board === 'visible-board');
    expect((await PATCH(req(body), ctx)).status).toBe(200);
    expect(m.visible).toHaveBeenCalledWith(expect.objectContaining({ fullAccess: false }), 'user', 'visible-board', 'user');
  });
  it('allows unlinking or relinking from hidden B because it does not alter B tags', async () => {
    m.responses.wa_conversations = { data: { id, contact_id: 'contact', is_group: false, deal_id: 'hidden-B' }, error: null };
    m.visible.mockReturnValue(false);
    expect((await PATCH(req({ dealId: null }), ctx)).status).toBe(200);
    expect(m.visible).not.toHaveBeenCalled();
    m.responses.deals = { data: { id, contact_id: 'contact', board_id: 'visible-board', owner_id: 'user' }, error: null };
    m.visible.mockImplementation((_access, _user, board) => board === 'visible-board');
    expect((await PATCH(req({ dealId: id }), ctx)).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({ deal_id: id });
  });
  it('passes the authorized link to the atomic write and rejects link races', async () => {
    m.responses.wa_conversations = { data: { id, contact_id: 'contact', is_group: false, deal_id: 'visible-A' }, error: null };
    m.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'Conversation link changed; refresh authorization' } });
    expect((await PATCH(req({ addLabelIds: [label] }), ctx)).status).toBe(409);
    expect(m.rpc).toHaveBeenCalledWith('mutate_conversation_labels', expect.objectContaining({ p_expected_deal: 'visible-A', p_check_link: true }));
    expect(m.rpc).toHaveBeenCalledTimes(3);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('conditions legacy replacements on the authorized link and rejects link races', async () => {
    m.responses.wa_conversations = { data: { id, contact_id: 'contact', is_group: false, deal_id: 'visible-A' }, error: null };
    m.responses.wa_conversations_write = { data: null, error: null };
    expect((await PATCH(req({ labelIds: [label] }), ctx)).status).toBe(409);
    expect(m.eq).toHaveBeenCalledWith('deal_id', 'visible-A');
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('retains legacy replacement and explicit unlink contracts', async () => {
    expect((await PATCH(req({ labelIds: [] }), ctx)).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({ label_ids: [] });
    expect((await PATCH(req({ dealId: null }), ctx)).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({ deal_id: null });
  });
});
