import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ role: 'admin', allowed: true, canGrant: true, grant: vi.fn(), policy: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({
  requireOrgUser: async () => ({ ok: true, user: { id: 'actor', organizationId: 'server-org', role: h.role }, admin: {} }),
  isOrgAdmin: (role: string) => role === 'admin',
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
}));
vi.mock('@/lib/ai-usage/access', () => ({ conversationUsageAccess: async () => ({ allowed: h.allowed, canGrant: h.canGrant }) }));
vi.mock('@/lib/ai-usage/budget', () => ({ grantConversationBudget: h.grant, updateUsagePolicy: h.policy, getUsagePolicy: h.read }));
import { POST } from './conversations/[id]/grant/route';
import { PATCH } from './policy/route';
const conversation = '10000000-0000-4000-8000-000000000001';
const operation = '20000000-0000-4000-8000-000000000002';
const ctx = { params: Promise.resolve({ id: conversation }) };
const request = (body: unknown, origin = 'https://crm.example', method = 'POST') => {
  const req = new Request('https://crm.example/api/ai-usage', { method, body: JSON.stringify(body) });
  // happy-dom strips forbidden browser request headers; a server receives them from the browser/proxy.
  Object.defineProperty(req, 'headers', { value: new Headers({ origin, 'x-forwarded-host': 'crm.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json' }) });
  return req;
};
const grant = { tokens: 500, reason: 'Continuação aprovada pelo responsável', idempotencyKey: operation };
beforeEach(() => { h.role = 'admin'; h.allowed = true; h.canGrant = true; h.grant.mockReset().mockResolvedValue({ tokens_granted: 500 }); h.policy.mockReset().mockResolvedValue({}); });
describe('usage mutation routes', () => {
  it('rejects cross-origin mutation before a grant', async () => {
    expect((await POST(request(grant, 'https://attacker.example'), ctx)).status).toBe(403); expect(h.grant).not.toHaveBeenCalled();
  });
  it('requires conversation visibility and responsible/admin authority', async () => {
    h.allowed = false; expect((await POST(request(grant), ctx)).status).toBe(404);
    h.allowed = true; h.canGrant = false; expect((await POST(request(grant), ctx)).status).toBe(403); expect(h.grant).not.toHaveBeenCalled();
  });
  it('scopes identity on the server and passes idempotency and attribution to the ledger', async () => {
    expect((await POST(request(grant), ctx)).status).toBe(200);
    expect(h.grant).toHaveBeenCalledWith({}, { ...grant, organizationId: 'server-org', conversationId: conversation, actorId: 'actor' });
    expect((await POST(request({ ...grant, organizationId: 'another-org' }), ctx)).status).toBe(400);
  });
  it.each([{ ...grant, tokens: -1 }, { ...grant, tokens: 0 }, { ...grant, reason: '' }, { ...grant, idempotencyKey: '' }])('rejects invalid grant %j', async body => {
    expect((await POST(request(body), ctx)).status).toBe(400); expect(h.grant).not.toHaveBeenCalled();
  });
  it('configuration requires admin and positive explicit quotas', async () => {
    const body = { enabled: true, conversation_tokens: 1000, organization_daily_tokens: 20000, conversation_audio_seconds: null, timezone: 'America/Manaus' };
    h.role = 'user'; expect((await PATCH(request(body, undefined, 'PATCH'))).status).toBe(403);
    h.role = 'admin'; expect((await PATCH(request({ ...body, conversation_tokens: null }, undefined, 'PATCH'))).status).toBe(400);
    expect((await PATCH(request(body, undefined, 'PATCH'))).status).toBe(200); expect(h.policy).toHaveBeenCalledWith({}, 'server-org', body);
  });
  it('enables only the requested conversation quota without inventing daily or audio limits', async () => {
    const body = { enabled: true, conversation_tokens: 300000, organization_daily_tokens: null, conversation_audio_seconds: null, timezone: 'America/Manaus' };
    expect((await PATCH(request(body, undefined, 'PATCH'))).status).toBe(200);
    expect(h.policy).toHaveBeenCalledExactlyOnceWith({}, 'server-org', body);
    expect(h.grant).not.toHaveBeenCalled();
  });
  it.each([0, -1])('rejects a nonpositive optional daily limit %s', async daily => {
    const body = { enabled: true, conversation_tokens: 300000, organization_daily_tokens: daily, conversation_audio_seconds: null, timezone: 'America/Manaus' };
    expect((await PATCH(request(body, undefined, 'PATCH'))).status).toBe(400);
    expect(h.policy).not.toHaveBeenCalled();
  });
});
