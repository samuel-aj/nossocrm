import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), allowed: vi.fn(), team: vi.fn(), visible: vi.fn(), rpc: vi.fn(), from: vi.fn(), eq: vi.fn(), limit: vi.fn(), responses: {} as Record<string, unknown> }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: m.allowed }));
vi.mock('@/lib/permissions/teamAccessServer', () => ({ getTeamAccess: m.team, visibleLead: m.visible }));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const conversation = { id, contact_id: 'contact', deal_id: null, deal_link_mode: 'auto', is_group: false };
const candidate = { id: 'lead', board_id: 'board', owner_id: 'owner' };
const req = () => new Request('https://crm.test/api/whatsapp/conversations/'+id+'/resolve-lead', { method: 'POST' });
const ctx = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  m.responses = { wa_conversations: { data: conversation, error: null }, deals: { data: [candidate], error: null } };
  m.from.mockImplementation(table => {
    const q: Record<string, unknown> = {};
    for (const key of ['select', 'is']) q[key] = vi.fn(() => q);
    q.eq = (...args: unknown[]) => { m.eq(...args); return q; };
    q.limit = (...args: unknown[]) => { m.limit(...args); return q; };
    q.maybeSingle = () => Promise.resolve(m.responses[table]);
    q.then = (resolve: (value: unknown) => void) => Promise.resolve(m.responses[table]).then(resolve);
    return q;
  });
  m.auth.mockResolvedValue({ ok: true, user: { id: 'user', organizationId: 'org' }, admin: { from: m.from, rpc: m.rpc } });
  m.allowed.mockResolvedValue(true); m.team.mockResolvedValue({ fullAccess: true }); m.visible.mockReturnValue(true);
  m.rpc.mockResolvedValue({ data: { ...conversation, deal_id: 'lead', label_ids: [] }, error: null });
});
describe('automatic link resolution', () => {
  it('authorizes the chat and sole lead before an organization-scoped conditional RPC', async () => {
    const response = await POST(req(), ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).conversation.deal_id).toBe('lead');
    expect(m.eq).toHaveBeenCalledWith('organization_id', 'org');
    expect(m.eq).toHaveBeenCalledWith('contact_id', 'contact');
    expect(m.limit).toHaveBeenCalledWith(2);
    expect(m.rpc).toHaveBeenCalledWith('resolve_conversation_deal_link', { p_org: 'org', p_conversation: id, p_contact: 'contact', p_candidate: 'lead', p_board: 'board', p_owner: 'owner' });
  });
  it.each([
    { ...conversation, is_group: true }, { ...conversation, deal_id: 'explicit' },
    { ...conversation, deal_link_mode: 'manual' }, { ...conversation, contact_id: null },
  ])('preserves explicit choices, groups and contactless conversations: %j', async row => {
    m.responses.wa_conversations = { data: row, error: null };
    expect((await POST(req(), ctx)).status).toBe(200);
    expect(m.from).not.toHaveBeenCalledWith('deals');
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([[], [candidate, { ...candidate, id: 'another' }]])('never guesses with zero or multiple candidates', async candidates => {
    m.responses.deals = { data: candidates, error: null };
    expect((await POST(req(), ctx)).status).toBe(200);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('rejects unauthorized conversations without querying or writing their data', async () => {
    m.allowed.mockResolvedValue(false);
    expect((await POST(req(), ctx)).status).toBe(404);
    expect(m.from).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('does not link a hidden sole lead', async () => {
    m.visible.mockReturnValue(false);
    const response = await POST(req(), ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).conversation.deal_id).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('surfaces lookup errors rather than declaring the chat unlinked', async () => {
    m.responses.deals = { data: null, error: { message: 'database unavailable' } };
    expect((await POST(req(), ctx)).status).toBe(500);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('keeps a manual unlink made while resolution was in flight', async () => {
    m.rpc.mockResolvedValue({ data: { ...conversation, deal_link_mode: 'manual' }, error: null });
    const response = await POST(req(), ctx);
    expect((await response.json()).conversation).toMatchObject({ deal_id: null, deal_link_mode: 'manual' });
  });
  it('returns a conflict when the authorized candidate changes', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '40001' } });
    expect((await POST(req(), ctx)).status).toBe(409);
    expect(m.rpc).toHaveBeenCalledTimes(3);
  });
});
