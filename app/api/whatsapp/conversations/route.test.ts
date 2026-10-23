// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), connection: vi.fn(), visible: vi.fn(), blocks: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionByOrg: m.connection }));
vi.mock('@/lib/whatsapp/visibleConversations', () => ({ listVisibleConversations: m.visible }));
vi.mock('@/lib/ai-usage/loadUsageBlocks', () => ({ loadUsageBlocks: m.blocks }));
import { GET } from './route';
const request = () => new Request('https://crm.test/api/whatsapp/conversations');
const block = { conversationId: 'visible', blockedAt: '2026-10-23T13:00:00Z', reason: 'conversation_token_limit' };
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ ok: true, user: { id: 'user', organizationId: 'org' }, admin: {} });
  m.connection.mockResolvedValue({ status: 'connected' });
  m.visible.mockResolvedValue({ data: [{ id: 'visible', wa_name: 'Lead', avatar_path: null }], error: null, groupsEnabled: false });
  m.blocks.mockResolvedValue({ visible: block });
});
it('projects only already visible conversations after tenant and connection authorization', async () => {
  const result = await (await GET(request())).json();
  expect(m.blocks).toHaveBeenCalledWith({}, 'org', ['visible']);
  expect(result.data[0]).toMatchObject({ id: 'visible', usage_block: block });
  expect(result.usageBlocksUnavailable).toBe(false);
});
it('preserves the inbox with an explicit unavailable flag when the supplemental projection fails', async () => {
  m.blocks.mockRejectedValue(new Error('database unavailable'));
  const response = await GET(request()); const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.data[0]).toMatchObject({ id: 'visible', wa_name: 'Lead', usage_block: null });
  expect(result.usageBlocksUnavailable).toBe(true);
});
it('does not consult usage when disconnected or unauthenticated', async () => {
  m.connection.mockResolvedValue({ status: 'disconnected' });
  expect(await (await GET(request())).json()).toEqual({ data: [], groupsEnabled: false });
  expect(m.blocks).not.toHaveBeenCalled();
  m.auth.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) });
  expect((await GET(request())).status).toBe(401);
  expect(m.blocks).not.toHaveBeenCalled();
});
it('never reads usage when conversation visibility lookup fails', async () => {
  m.visible.mockResolvedValue({ data: null, error: { message: 'unavailable' }, groupsEnabled: false });
  expect((await GET(request())).status).toBe(500);
  expect(m.blocks).not.toHaveBeenCalled();
});
