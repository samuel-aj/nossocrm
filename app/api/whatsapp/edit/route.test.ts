import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
const state = vi.hoisted(() => ({ message: {} as Record<string, unknown>, allowed: true, provider: 'evolution', connected: true,
  edit: vi.fn(), writes: [] as Array<{ table: string; patch: Record<string, unknown> }>, filters: [] as unknown[], auth: true }));
const id = '11111111-1111-4111-8111-111111111111';
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: async () => state.allowed }));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionByIdForOrg: async () => ({ id: 'original-connection', provider: state.provider, status: state.connected ? 'connected' : 'disconnected' }) }));
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ editText: state.edit }) }));
vi.mock('@/lib/whatsapp/api', () => ({
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  requireOrgUser: async () => state.auth ? ({ ok: true, user: { id: 'me', organizationId: 'org', role: 'sales' }, admin: {
    from: (table: string) => {
      let updating = false;
      const chain = {
        select: () => chain, eq: (key: string, value: unknown) => { state.filters.push([table, key, value]); return chain; },
        update: (patch: Record<string, unknown>) => { updating = true; state.writes.push({ table, patch }); return chain; },
        order: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: table === 'wa_messages' ? state.message : { id: 'conversation', connection_id: 'original-connection', wa_phone: '+5569999999999', last_message_at: '2026-09-15T12:00:00Z' }, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: updating ? null : [], error: null }),
      }; return chain;
    },
  } }) : ({ ok: false, response: Response.json({}, { status: 401 }) }),
}));
function request(body: unknown = { messageId: id, text: 'Depois' }) { return new Request('https://crm.test/api/whatsapp/edit', { method: 'POST', body: JSON.stringify(body) }); }
describe('edit message endpoint', () => {
  beforeEach(() => {
    state.message = { id, conversation_id: 'conversation', direction: 'out', sent_by: 'me', status: 'sent', body: 'Antes', evolution_message_id: 'provider-original-id', created_at: new Date().toISOString() };
    state.allowed = true; state.auth = true; state.connected = true; state.provider = 'evolution'; state.writes = []; state.filters = [];
    state.edit.mockReset().mockResolvedValue({ ok: true });
  });
  it('uses the original provider ID and preserves the original timestamp', async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(state.edit).toHaveBeenCalledWith({ to: '+5569999999999', providerMessageId: 'provider-original-id', text: 'Depois' });
    expect(state.filters).toContainEqual(['wa_messages', 'organization_id', 'org']);
    const update = state.writes.find(write => write.table === 'wa_messages')!.patch;
    expect(update).toEqual({ body: 'Depois', edited_at: expect.any(String) });
  });
  it('rejects unauthenticated and inaccessible messages before calling the provider', async () => {
    state.auth = false; expect((await POST(request())).status).toBe(401);
    state.auth = true; state.allowed = false; expect((await POST(request())).status).toBe(404);
    expect(state.edit).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it('rejects another sender, expired edits, media and unsupported connections', async () => {
    state.message.sent_by = 'other'; expect((await POST(request())).status).toBe(403);
    state.message.sent_by = 'me'; state.message.created_at = '2020-01-01'; expect((await POST(request())).status).toBe(403);
    state.message.created_at = new Date().toISOString(); state.message.media_type = 'image'; expect((await POST(request())).status).toBe(403);
    state.message.media_type = null; state.provider = 'meta_cloud'; expect((await POST(request())).status).toBe(403);
    expect(state.edit).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it('keeps the stored message if the provider rejects the edit', async () => {
    state.edit.mockResolvedValue({ ok: false, error: 'Prazo encerrado' });
    expect((await POST(request())).status).toBe(502); expect(state.writes).toEqual([]);
  });
  it('validates empty text and rejects disconnected sending', async () => {
    expect((await POST(request({ messageId: id, text: '   ' }))).status).toBe(400);
    state.connected = false; expect((await POST(request())).status).toBe(409); expect(state.edit).not.toHaveBeenCalled();
  });
});
