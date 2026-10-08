import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ guard: vi.fn(), sendText: vi.fn(), sendMedia: vi.fn(), sendTemplate: vi.fn(), ensure: vi.fn(), record: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: async () => ({ ok: true, user: { id: 'u', organizationId: 'org' }, admin: {
  from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { meta_status: 'APPROVED' } }) }; return q; },
} }), json: (b: unknown, status = 200) => Response.json(b, { status }) }));
vi.mock('@/lib/permissions/server', () => ({ connectionAllowed: () => true, getVisibilityRules: async () => null }));
vi.mock('@/lib/whatsapp/sendWindow', () => ({ checkSendWindow: m.guard }));
vi.mock('@/lib/whatsapp/templateMedia', () => ({ resolveTemplateComponents: async () => [] }));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionByOrg: async () => ({ id: 'sender', provider: 'meta_cloud', status: 'connected' }), getConnectionByIdForOrg: async () => ({ id: 'sender', provider: 'meta_cloud', status: 'connected' }), ensureConversation: m.ensure, getGroupConversation: vi.fn(), getWaGroupsEnabled: vi.fn(), getQuotableMessage: vi.fn(), recordOutboundMessage: m.record, replicateOutboundToSiblings: vi.fn() }));
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ sendText: m.sendText, sendMedia: m.sendMedia, sendTemplate: m.sendTemplate }) }));
import { POST } from './route';
const req = (extra = {}) => new Request('https://crm.test/api/whatsapp/send', { method: 'POST', headers: { host: 'crm.test', origin: 'https://crm.test', 'content-type': 'application/json' }, body: JSON.stringify({ to: '+551198765432', text: 'teste', connectionId: 'sender', ...extra }) });
beforeEach(() => {
  vi.clearAllMocks(); m.guard.mockResolvedValue('Janela fechada'); m.ensure.mockResolvedValue({ id: 'conv' });
  m.sendText.mockResolvedValue({ ok: true }); m.sendTemplate.mockResolvedValue({ ok: true }); m.record.mockResolvedValue({ body: 'teste' });
});
it('rejects an expired window before calling the provider or recording a failed bubble', async () => {
  expect((await POST(req())).status).toBe(409);
  expect(m.sendText).not.toHaveBeenCalled(); expect(m.record).not.toHaveBeenCalled(); expect(m.ensure).not.toHaveBeenCalled();
});
it('cannot bypass the media guard by also supplying a template name', async () => {
  expect((await POST(req({ media: { path: 'org/file.jpg', kind: 'image' }, template: { name: 'hello' } }))).status).toBe(409);
  expect(m.guard).toHaveBeenCalledWith(expect.anything(), 'org', expect.objectContaining({ id: 'sender' }), '+551198765432', { template: false });
  expect(m.sendMedia).not.toHaveBeenCalled();
});
it('allows approved templates through the dedicated template path', async () => {
  m.guard.mockResolvedValue(null);
  expect((await POST(req({ template: { name: 'hello' } }))).status).toBe(200);
  expect(m.guard).toHaveBeenCalledWith(expect.anything(), 'org', expect.anything(), '+551198765432', { template: true });
  expect(m.sendTemplate).toHaveBeenCalled(); expect(m.sendText).not.toHaveBeenCalled();
});
it('sends ordinary text when the server confirms an open window', async () => {
  m.guard.mockResolvedValue(null);
  expect((await POST(req())).status).toBe(200); expect(m.sendText).toHaveBeenCalled();
});
