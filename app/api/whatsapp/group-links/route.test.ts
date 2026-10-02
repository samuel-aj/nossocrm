// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), mutate: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/whatsapp/group-links/reads', () => ({ getGroupLinks: m.read }));
vi.mock('@/lib/whatsapp/group-links/service', () => ({ mutateGroupLink: m.mutate }));
import { GET, POST } from './route';
import { GroupLinksError } from '@/lib/whatsapp/group-links/types';
const id = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const user = { id: 'user', organizationId: 'tab-org', role: 'sales' };
const admin = {};
const body = { conversationId: id, entityId, entityType: 'deal', action: 'link' };
const post = (input: unknown, origin?: string) => new Request('https://crm.test/api/whatsapp/group-links', { method: 'POST', headers: { 'x-forwarded-host': 'crm.test', ...(origin ? { origin } : {}) }, body: JSON.stringify(input) });
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ ok: true, admin, user }); m.read.mockResolvedValue({ enabled: false, groups: [], contacts: [], deals: [] }); m.mutate.mockResolvedValue(undefined); });
describe('group link endpoint', () => {
  it.each(['conversationId', 'contactId', 'dealId'])('passes exact %s and scoped user to service', async key => {
    const result = await GET(new Request(`https://crm.test/api/whatsapp/group-links?${key}=${id}`));
    expect(result.status).toBe(200); expect(m.read).toHaveBeenCalledWith(admin, user, { [key]: id });
    expect(await result.json()).toEqual({ enabled: false, groups: [], contacts: [], deals: [] });
  });
  it.each(['', '?dealId=bad', `?dealId=${id}&contactId=${entityId}`, `?dealId=${id}&dealId=${id}`])('rejects ambiguous or malformed selection %s', async query => {
    expect((await GET(new Request(`https://crm.test/api/whatsapp/group-links${query}`))).status).toBe(400); expect(m.read).not.toHaveBeenCalled();
  });
  it.each(['link', 'unlink', 'set_primary'])('accepts delta %s', async action => {
    expect(await (await POST(post({ ...body, action }))).json()).toEqual({ ok: true });
    expect(m.mutate).toHaveBeenCalledWith(admin, user, { ...body, action });
  });
  it.each([{ ...body, entityType: 'company' }, { ...body, conversationId: 'bad' }, { ...body, groupId: 'arbitrary' }, { ...body, entityType: 'contact', action: 'set_primary' }])('rejects malformed writes %j', async input => {
    expect((await POST(post(input))).status).toBe(400); expect(m.mutate).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON', async () => expect((await POST(new Request('https://crm.test/api/whatsapp/group-links', { method: 'POST', body: '{' }))).status).toBe(400));
  it('blocks cross origin writes', async () => {
    expect((await POST(post(body, 'https://evil.test'))).status).toBe(403); expect(m.auth).not.toHaveBeenCalled();
  });
  it.each([404, 409, 500])('preserves friendly service status %s', async status => {
    m.mutate.mockRejectedValue(new GroupLinksError('Indisponível.', status));
    expect((await POST(post(body))).status).toBe(status);
  });
  it('returns auth failures unchanged', async () => {
    m.auth.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await GET(new Request(`https://crm.test/api/whatsapp/group-links?dealId=${id}`))).status).toBe(401);
    expect(m.read).not.toHaveBeenCalled();
  });
});
