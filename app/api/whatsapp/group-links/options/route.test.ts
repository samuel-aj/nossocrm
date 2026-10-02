// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), options: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/whatsapp/group-links/reads', () => ({ getGroupLinkOptions: m.options }));
import { GET } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const user = { id: 'user', organizationId: 'tab-org', role: 'sales' };
const admin = {};
const req = (query: string) => new Request(`https://crm.test/api/whatsapp/group-links/options?${query}`);
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ ok: true, admin, user }); m.options.mockResolvedValue([]); });
describe('group link options endpoint', () => {
  it('passes bounded search in the authenticated scope', async () => {
    expect(await (await GET(req(`conversationId=${id}&type=contact&q=%20Ana%20`))).json()).toEqual({ items: [] });
    expect(m.options).toHaveBeenCalledWith(admin, user, id, 'contact', 'Ana');
  });
  it.each([`conversationId=${id}&type=other`, 'type=deal', `conversationId=${id}&type=deal&q=${'a'.repeat(201)}`, `conversationId=${id}&type=deal&type=contact`])('rejects invalid input', async query => {
    expect((await GET(req(query))).status).toBe(400); expect(m.options).not.toHaveBeenCalled();
  });
  it('fails closed with friendly errors', async () => {
    m.options.mockRejectedValue(new Error('secret'));
    const result = await GET(req(`conversationId=${id}&type=deal`)); expect(result.status).toBe(500); expect(JSON.stringify(await result.json())).not.toContain('secret');
  });
});
