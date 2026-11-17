import { beforeEach, expect, it, vi } from 'vitest';
import type { RequireOrgResult } from './api';
const h = vi.hoisted(() => ({ claim: vi.fn(), touch: vi.fn(), finish: vi.fn(), release: vi.fn(), send: vi.fn(), text: vi.fn(), record: vi.fn(), replicate: vi.fn(), auth: vi.fn(), hook: vi.fn() }));
vi.mock('@/lib/whatsapp/mediaCooldown', async original => ({ ...await original<typeof import('./mediaCooldown')>(), claimMediaCooldown: h.claim, beginMediaCooldownDispatch: h.touch, finishMediaCooldownDispatch: h.finish, releaseMediaCooldown: h.release }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: h.auth, json: (b: unknown, status = 200) => Response.json(b, { status }) }));
vi.mock('@/lib/permissions/server', () => ({ connectionAllowed: () => true, getVisibilityRules: async () => null, filterAllowedConnections: (_v: unknown, rows: unknown) => rows }));
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: async () => true }));
vi.mock('@/lib/whatsapp/sendWindow', () => ({ checkSendWindow: async () => null }));
vi.mock('@/lib/whatsapp/service', () => ({
  getConnectionByOrg: async () => ({ id: 'conn', status: 'connected' }), getConnectionByIdForOrg: async () => ({ id: 'conn', status: 'connected' }),
  getConnectionsByOrg: async () => [{ id: 'conn', status: 'connected' }], ensureConversation: async (_db: unknown, _org: string, _conn: string, phone: string) => ({ id: phone }),
  getGroupConversation: vi.fn(), getWaGroupsEnabled: async () => false, getQuotableMessage: vi.fn(), recordOutboundMessage: h.record, replicateOutboundToSiblings: h.replicate,
}));
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ sendMedia: h.send, sendText: h.text }) }));
import { sendMessage } from './sendMessage';
import { MediaCooldownError } from './mediaCooldown';
import { POST as forward } from '@/app/api/whatsapp/forward/route';
const media = { path: 'org/out/video.mp4', kind: 'video' };
const messages = [{ id: 'm', body: '', media_type: 'video', media_url: media.path, media_mime: 'video/mp4', conversation_id: 'source' }];
function auth() {
  const q = { select: () => q, eq: () => q, in: () => q, is: () => q, order: async () => ({ data: messages }) };
  return { ok: true, user: { id: 'user', organizationId: 'org', role: 'admin' }, admin: {
    from: () => q, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://media.invalid/fresh?signature=1' } }), createSignedUrls: async () => ({ data: [{ path: media.path, signedUrl: 'https://media.invalid/fresh?signature=2' }] }) }) },
  } } as Extract<RequireOrgResult, { ok: true }>;
}
const forwardReq = (targets = [{ phone: '+5511999990000', connectionId: 'conn' }]) => new Request('https://crm.test/api/whatsapp/forward', { method: 'POST', body: JSON.stringify({ messageIds: ['m'], targets }) });
beforeEach(() => {
  vi.clearAllMocks(); h.auth.mockResolvedValue(auth()); h.claim.mockResolvedValue({ attemptId: 'attempt' }); h.touch.mockResolvedValue(undefined); h.release.mockResolvedValue(undefined);
  h.send.mockResolvedValue({ ok: true, providerMessageId: 'sent' }); h.text.mockResolvedValue({ ok: true, providerMessageId: 'sent' }); h.record.mockResolvedValue({ id: 'saved', body: '' });
});
it('returns 409 and Retry-After before hooks, provider or chat recording for manual/API media', async () => {
  h.claim.mockRejectedValueOnce(new MediaCooldownError(37));
  const response = await sendMessage(auth(), { to: '+5511999990000', media }, { hooks: { beforeDispatch: h.hook } });
  expect(response.status).toBe(409); expect(response.headers.get('Retry-After')).toBe('37');
  expect(await response.json()).toMatchObject({ ok: false, code: 'MEDIA_COOLDOWN', retryAfterSeconds: 37 });
  expect(h.hook).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
});
it('uses the stable path and dispatch refresh, while text remains unaffected', async () => {
  expect((await sendMessage(auth(), { to: '+5511999990000', media })).status).toBe(200);
  expect(h.claim).toHaveBeenCalledWith(expect.anything(), { organizationId: 'org', conversationId: '+5511999990000', mediaPath: media.path });
  expect(h.touch).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1);
  expect((await sendMessage(auth(), { to: '+5511999990000', text: 'Olá' })).status).toBe(200);
  expect(h.claim).toHaveBeenCalledTimes(1);
});
it('releases pre-dispatch failures but retains uncertain provider failures', async () => {
  h.hook.mockRejectedValueOnce(new Error('takeover'));
  await expect(sendMessage(auth(), { to: '+5511999990000', media }, { hooks: { beforeDispatch: h.hook } })).rejects.toThrow('takeover');
  expect(h.release).toHaveBeenCalledTimes(1); expect(h.send).not.toHaveBeenCalled();
  h.send.mockRejectedValueOnce(new Error('timeout'));
  await expect(sendMessage(auth(), { to: '+5511999990000', media })).rejects.toThrow('timeout');
  expect(h.release).toHaveBeenCalledTimes(1);
});
it('fails closed on storage guard errors without creating failed bubbles', async () => {
  h.claim.mockRejectedValueOnce(new Error('DB unavailable'));
  await expect(sendMessage(auth(), { to: '+5511999990000', media })).rejects.toThrow('DB unavailable');
  expect(h.send).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
});
it('renews the dispatch lease before the MCP dispatching hook and finishes before acknowledgement hooks', async () => {
  h.touch.mockRejectedValueOnce(new Error('lease unavailable'));
  await expect(sendMessage(auth(), { to: '+5511999990000', media }, { hooks: { beforeDispatch: h.hook } })).rejects.toThrow('lease unavailable');
  expect(h.hook).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
  const afterDispatch = vi.fn();
  await sendMessage(auth(), { to: '+5511999990000', media }, { hooks: { beforeDispatch: h.hook, afterDispatch } });
  expect(h.touch.mock.invocationCallOrder[1]).toBeLessThan(h.hook.mock.invocationCallOrder[0]);
  expect(h.finish.mock.invocationCallOrder[0]).toBeLessThan(afterDispatch.mock.invocationCallOrder[0]);
});
it('counts a suppressed forward separately without a phantom message or sibling replication', async () => {
  h.claim.mockRejectedValueOnce(new MediaCooldownError(12));
  const response = await forward(forwardReq());
  expect(response.status).toBe(207);
  expect(await response.json()).toMatchObject({ ok: false, results: [{ sent: 0, failed: 0, suppressed: 1, code: 'MEDIA_COOLDOWN', retryAfterSeconds: 12 }] });
  expect(h.send).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled(); expect(h.replicate).not.toHaveBeenCalled();
});
it('continues forwarding to a different customer after one target is suppressed', async () => {
  h.claim.mockRejectedValueOnce(new MediaCooldownError(12));
  const response = await forward(forwardReq([{ phone: '+5511999990000', connectionId: 'conn' }, { phone: '+5511999990001', connectionId: 'conn' }]));
  const data = await response.json();
  expect(data.results[0].suppressed).toBe(1); expect(data.results[1]).toMatchObject({ ok: true, sent: 1, failed: 0 });
  expect(h.claim.mock.calls.map(c => c[1].conversationId)).toEqual(['+5511999990000', '+5511999990001']);
  expect(h.send).toHaveBeenCalledTimes(1); expect(h.record).toHaveBeenCalledTimes(1);
});
it('does not forward when reservation storage is unavailable', async () => {
  h.claim.mockRejectedValueOnce(new Error('DB unavailable'));
  expect(await (await forward(forwardReq())).json()).toMatchObject({ ok: false, results: [{ sent: 0, failed: 1, error: 'DB unavailable' }] });
  expect(h.send).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
});
