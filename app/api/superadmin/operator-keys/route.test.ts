import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from './route';

const db = vi.hoisted(() => ({
  role: 'super_admin', session: true, from: vi.fn(), insert: vi.fn(), update: vi.fn(),
  select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({ from: db.from }),
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: db.session ? { id: 'actor' } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: db.role } }) }) }) }),
  }),
}));
vi.mock('@/lib/security/auditLog', () => ({ logSecurityEvent: vi.fn() }));
import { logSecurityEvent } from '@/lib/security/auditLog';

const keyId = '00000000-0000-4000-8000-000000000001';
const record = { id: keyId, name: 'Monitor de teste' };
const req = (method: string, body?: object, origin = 'https://crm.example') => new Request('https://crm.example/api/superadmin/operator-keys', {
  method, headers: { origin, host: 'crm.example', 'x-forwarded-proto': 'https' }, body: body && JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); db.role = 'super_admin'; db.session = true;
  db.from.mockReturnValue(db); db.insert.mockReturnValue(db); db.update.mockReturnValue(db);
  db.select.mockReturnValue(db); db.eq.mockReturnValue(db); db.is.mockReturnValue(db);
  db.order.mockResolvedValue({ data: [record] }); db.single.mockResolvedValue({ data: record });
  db.maybeSingle.mockResolvedValue({ data: record });
});

it.each(['admin', 'vendedor', 'member'])('nega listagem, emissão e revogação ao perfil %s', async role => {
  db.role = role;
  expect((await GET(req('GET'))).status).toBe(403);
  expect((await POST(req('POST', { name: 'Teste' }))).status).toBe(403);
  expect((await DELETE(req('DELETE', { id: keyId }))).status).toBe(403);
  expect(db.from).not.toHaveBeenCalled();
});
it('exige sessão válida, mesma origem e um formato que não aceite permissões extras', async () => {
  db.session = false;
  expect((await POST(req('POST', { name: 'Teste' }))).status).toBe(401);
  db.session = true;
  expect((await DELETE(req('DELETE', { id: keyId }, 'https://outside.example'))).status).toBe(403);
  expect((await POST(req('POST', { name: 'Teste', scopes: ['write'] }))).status).toBe(422);
  expect(db.from).not.toHaveBeenCalled();
});
it('devolve o segredo apenas na criação e armazena somente hash e prefixo', async () => {
  const response = await POST(req('POST', { name: record.name }));
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const { token } = await response.json();
  expect(token).toMatch(/^ncrmop_[A-Za-z0-9_-]{32}$/);
  expect(db.insert).toHaveBeenCalledWith({ name: record.name, created_by: 'actor', scope: 'ai_agents_read',
    key_hash: createHash('sha256').update(token).digest('hex'), key_prefix: token.slice(0, 12) });
  expect(JSON.stringify(vi.mocked(logSecurityEvent).mock.calls[0][0])).not.toContain(token);
  const list = await GET(req('GET'));
  expect(await list.json()).toEqual({ data: [record] });
  for (const [fields] of db.select.mock.calls) expect(fields.split(',')).not.toEqual(expect.arrayContaining(['key_hash']));
  expect(db.from.mock.calls.every(([table]) => table === 'aj_operator_keys')).toBe(true);
});
it('grava o escopo escolhido, usa a leitura de agentes como padrão e recusa escopo desconhecido', async () => {
  expect((await POST(req('POST', { name: 'Esteira de teste', scope: 'feedback' }))).status).toBe(201);
  expect(db.insert).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Esteira de teste', scope: 'feedback' }));
  expect(logSecurityEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'api_key.created', details: { scope: 'feedback' } }), expect.anything(), expect.anything());
  expect((await POST(req('POST', { name: 'Monitor de teste' }))).status).toBe(201);
  expect(db.insert).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'ai_agents_read' }));
  expect(db.select).toHaveBeenCalledWith(expect.stringContaining('scope'));
  db.from.mockClear();
  for (const scope of ['admin', 'ai_agents_write', null]) {
    expect((await POST(req('POST', { name: 'Teste', scope }))).status).toBe(422);
  }
  expect(db.from).not.toHaveBeenCalled();
});
it('revoga apenas a chave ativa solicitada e identifica o administrador', async () => {
  expect((await DELETE(req('DELETE', { id: keyId }))).status).toBe(200);
  expect(db.update).toHaveBeenCalledWith({ revoked_by: 'actor', revoked_at: expect.any(String) });
  expect(db.eq).toHaveBeenCalledWith('id', keyId);
  expect(db.is).toHaveBeenCalledWith('revoked_at', null);
});
