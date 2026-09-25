import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';
const mocks = vi.hoisted(() => ({ from: vi.fn(), ai: vi.fn(), bot: vi.fn(), visible: ['a', 'b'] }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: async () => ({ ok: true, admin: { from: mocks.from }, user: { id: 'user', organizationId: 'org', role: 'admin' } }), json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionsByOrg: async () => [{ id: 'one', status: 'connected', provider: 'meta_cloud' }, { id: 'two', status: 'connected', provider: 'meta_cloud' }], getWaGroupsEnabled: async () => false, getGroupConversation: vi.fn() }));
vi.mock('@/lib/permissions/server', () => ({ getVisibilityRules: async () => null, filterAllowedConnections: (_rules: unknown, connections: unknown) => connections, connectionAllowed: () => true, filterConversationsByOwner: async (_admin: unknown, _org: string, _rules: unknown, _user: string, rows: Array<{ id: string }>) => rows.filter(r => mocks.visible.includes(r.id)) }));
vi.mock('@/lib/wa-agents/conversation', () => ({ getConversationAiInfo: mocks.ai, getConversationBotInfo: mocks.bot }));
const convs = [
  { id: 'a', connection_id: 'one', contact_id: 'contact', ai_status: 'active' },
  { id: 'b', connection_id: 'two', contact_id: 'contact', ai_status: 'active' },
];
beforeEach(() => {
  mocks.visible = ['a', 'b']; mocks.ai.mockReset().mockImplementation(async (_admin, c) => ({ conversationId: c.id })); mocks.bot.mockReset().mockImplementation(async (_admin, c) => ({ conversationId: c.conversationId }));
  mocks.from.mockImplementation((table: string) => {
    let ids: string[] = []; let single = false;
    const q: Record<string, any> = {};
    for (const name of ['select', 'eq', 'order', 'limit', 'update', 'gt', 'lt', 'is', 'overlaps']) q[name] = () => q;
    q.in = (field: string, value: string[]) => { if (field === 'conversation_id') ids = value; return q; };
    q.maybeSingle = () => { single = true; return q; };
    q.then = (resolve: (value: unknown) => unknown) => resolve({ error: null, data: table === 'wa_conversations' ? convs : single
      ? (ids.includes('a') ? { created_at: '2026-09-24T12:00:00Z', wa_timestamp: null } : null)
      : convs.filter(c => ids.includes(c.id)).map(c => ({ id: `message-${c.id}`, conversation_id: c.id, body: c.id, direction: 'in', created_at: '2026-09-24T12:00:00Z' })) });
    return q;
  });
});
it('shows both numbers in history while targeting actions to the selected sender', async () => {
  const response = await GET(new Request('https://crm.test/api/whatsapp/messages?phone=5569999926070&contextConnectionId=two'));
  const body = await response.json();
  expect(body.messages.map((m: any) => m.connection_id).sort()).toEqual(['one', 'two']);
  expect(body.ai.conversationId).toBe('b'); expect(body.bot.conversationId).toBe('b');
  expect(body.conversation.id).toBe('b');
  expect(body.lastInboundByConnection).toEqual({ one: '2026-09-24T12:00:00Z', two: null });
});
it('never expands message visibility or action context to an inaccessible conversation', async () => {
  mocks.visible = ['a'];
  const body = await (await GET(new Request('https://crm.test/api/whatsapp/messages?phone=5569999926070&contextConnectionId=two'))).json();
  expect(body.messages.map((m: any) => m.connection_id)).toEqual(['one']);
  expect(body.conversation).toBeNull(); expect(body.ai).toBeNull(); expect(body.bot).toBeNull();
  expect(mocks.ai).not.toHaveBeenCalled(); expect(mocks.bot).not.toHaveBeenCalled();
});
