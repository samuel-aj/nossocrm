import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), group: vi.fn(), connection: vi.fn(), enabled: vi.fn(), participants: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: m.access }));
vi.mock('@/lib/whatsapp/service', () => ({ getGroupConversation: m.group, getConnectionByIdForOrg: m.connection, getWaGroupsEnabled: m.enabled }));
vi.mock('@/lib/whatsapp/groups', () => ({ getGroupParticipants: m.participants }));
import { GET } from './route';
const id = '00000000-0000-4000-8000-000000000001';
const request = () => new Request(`https://crm.test/api/whatsapp/groups/participants?conversationId=${id}`);
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ ok: true, user: { id: 'u', organizationId: 'org' }, admin: {} }); m.access.mockResolvedValue(true); m.enabled.mockResolvedValue(true); m.group.mockResolvedValue({ id, connection_id: 'conn', group_jid: '123@g.us' }); m.connection.mockResolvedValue({ id: 'conn', status: 'connected' }); m.participants.mockResolvedValue({ ok: true, participants: [] }); });
describe('group members authorization', () => {
  it('rejects anonymous access before fetching provider', async () => { m.auth.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) }); expect((await GET(request())).status).toBe(401); expect(m.participants).not.toHaveBeenCalled(); });
  it('enforces full conversation visibility before reading members', async () => { m.access.mockResolvedValue(false); expect((await GET(request())).status).toBe(404); expect(m.participants).not.toHaveBeenCalled(); });
  it('always scopes group and connection to the current organization', async () => { expect((await GET(request())).status).toBe(200); expect(m.group).toHaveBeenCalledWith({}, 'org', id); expect(m.connection).toHaveBeenCalledWith({}, 'org', 'conn'); });
  it('reports unsupported providers clearly', async () => { m.participants.mockResolvedValue({ ok: false, unsupported: true, error: 'Indisponível nesta conexão' }); const result = await GET(request()); expect(result.status).toBe(422); expect(await result.json()).toMatchObject({ unsupported: true }); });
});
