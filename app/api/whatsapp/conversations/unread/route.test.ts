import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';
const mocks = vi.hoisted(() => ({ visible: vi.fn(), in: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: async () => ({ ok: true, user: { id: 'user', organizationId: 'org' }, admin: { from: () => ({ update: mocks.update }) } }), json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/whatsapp/visibleConversations', () => ({ listVisibleConversations: mocks.visible }));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionByOrg: vi.fn() }));
beforeEach(() => {
  mocks.in.mockClear(); mocks.update.mockReset();
  const q = { eq: () => q, in: mocks.in.mockImplementation(() => q), or: async () => ({ error: null }) };
  mocks.update.mockReturnValue(q);
  mocks.visible.mockResolvedValue({ error: null, data: [{ id: 'allowed', contact_id: 'c', wa_phone: '+5569999926070', connection_id: 'one' }] });
});
it('marks only visible conversation IDs, even when the phone also has restricted numbers', async () => {
  const res = await POST(new Request('https://crm.test/api/whatsapp/conversations/unread', { method: 'POST', body: JSON.stringify({ phone: '+5569999926070', connectionId: null }) }));
  expect(res.status).toBe(200); expect(mocks.in).toHaveBeenCalledWith('id', ['allowed']);
});
it('does not update anything if no visible conversation matches the phone', async () => {
  const res = await POST(new Request('https://crm.test/api/whatsapp/conversations/unread', { method: 'POST', body: JSON.stringify({ phone: '+5511999999999' }) }));
  expect(res.status).toBe(404); expect(mocks.update).not.toHaveBeenCalled();
});
