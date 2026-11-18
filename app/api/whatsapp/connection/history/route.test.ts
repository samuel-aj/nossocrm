import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rules: vi.fn() }));
vi.mock('@/lib/whatsapp/api', async original => ({ ...await original<typeof import('@/lib/whatsapp/api')>(), requireOrgUser: mocks.auth }));
vi.mock('@/lib/permissions/server', async original => ({ ...await original<typeof import('@/lib/permissions/server')>(), getVisibilityRules: mocks.rules }));

const connectionId = '10000000-0000-4000-8000-100000000001';
const otherId = '10000000-0000-4000-8000-100000000002';
const orgId = '20000000-0000-4000-8000-100000000001';
const openedAt = '2026-11-18T13:55:03.123456+00:00';
const request = (params = `connectionId=${connectionId}`) => new Request(`https://crm.example/api/whatsapp/connection/history?${params}`);
const incident = (n: number) => ({
  id: '30000000-0000-4000-8000-' + n.toString().padStart(12, '0'),
  opened_at: openedAt, resolved_at: null, resolution: null, source: 'send_blocked',
  diagnostic_reason: 'evolution_disconnect_401', diagnostic_source: 'webhook', diagnostic_at: openedAt,
});
function setup() {
  const line = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: connectionId } }) };
  const admin = { from: vi.fn().mockReturnValue(line), rpc: vi.fn().mockResolvedValue({ data: [] }) };
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'member', role: 'vendedor', organizationId: orgId }, admin });
  mocks.rules.mockResolvedValue(null);
  return { admin, line };
}

beforeEach(() => vi.clearAllMocks());
describe('GET de histórico por número', () => {
  it('requer sessão e valida número e cursor antes de buscar incidentes', async () => {
    const { admin } = setup();
    mocks.auth.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(request())).status).toBe(401);
    for (const params of ['', 'connectionId=42', `connectionId=${connectionId}&connectionId=${otherId}`, `connectionId=${connectionId}&cursor=!`, `connectionId=${connectionId}&cursor=`]) {
      expect((await GET(request(params))).status).toBe(400);
    }
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('aplica visibilidade e organização e retorna o mesmo 404 para linhas inacessíveis', async () => {
    const { admin, line } = setup();
    mocks.rules.mockResolvedValueOnce({ whatsapp: { connection_ids: [otherId] } });
    const hidden = await GET(request());
    expect(hidden.status).toBe(404);
    expect(admin.from).not.toHaveBeenCalled();
    line.maybeSingle.mockResolvedValueOnce({ data: null });
    const foreign = await GET(request());
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await hidden.json());
    expect(line.select).toHaveBeenCalledWith('id');
    expect(line.eq.mock.calls).toEqual([['organization_id', orgId], ['id', connectionId]]);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('retorna vazio somente após uma leitura bem-sucedida', async () => {
    const { admin } = setup();
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    admin.rpc.mockResolvedValueOnce({ error: new Error('internal_error_private') });
    const failure = await GET(request());
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain('internal_error_private');
    mocks.rules.mockRejectedValueOnce(new Error('visibility lookup unavailable'));
    expect((await GET(request())).status).toBe(503);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });

  it('carrega só a próxima página deste número sem perder precisão ou vazar campos internos', async () => {
    const { admin } = setup();
    const rows = Array.from({ length: 11 }, (_, i) => ({ ...incident(11 - i), line_label: 'private', internal: 'private' }));
    admin.rpc.mockResolvedValueOnce({ data: rows });
    const first = await (await GET(request())).json();
    expect(first.items).toHaveLength(10);
    expect(first.items[0]).toEqual({
      id: rows[0].id, openedAt, resolvedAt: null, resolution: null, detectedBy: 'Controle de envio do CRM',
      observation: 'A Evolution informou o código de desconexão 401.', observedBy: 'Evento recebido do provedor', observedAt: openedAt,
    });
    expect(JSON.stringify(first)).not.toContain('private');
    const cursor = encodeURIComponent(first.nextCursor);
    expect((await GET(request(`connectionId=${otherId}&cursor=${cursor}`))).status).toBe(400);
    admin.rpc.mockResolvedValueOnce({ data: [{ ...rows[10], resolution: 'disabled', resolved_at: openedAt }] });
    const next = await (await GET(request(`connectionId=${connectionId}&cursor=${cursor}`))).json();
    expect(admin.rpc).toHaveBeenLastCalledWith('wa_connection_history', { p_org: orgId, p_connection: connectionId, p_before_at: openedAt, p_before_id: rows[9].id, p_limit: 11 });
    expect(next.nextCursor).toBeNull();
    expect(next.items[0]).toMatchObject({ id: rows[10].id, resolution: 'disabled', resolvedAt: openedAt });
  });
});
