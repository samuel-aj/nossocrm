import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { API_KEY_COLUMNS, getAuthedAdmin } from '@/lib/apiKeys/server';
import { logSecurityEvent } from '@/lib/security/auditLog';

const { from, insert, select, eq, order, single } = vi.hoisted(() => ({
  from: vi.fn(), insert: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), single: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => ({ from }) }));
vi.mock('@/lib/apiKeys/server', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/apiKeys/server')>(),
  getAuthedAdmin: vi.fn(), makeApiKeyToken: () => ({ token: 'token-ficticio', hash: 'hash-ficticio', prefix: 'prefixo' }),
}));
vi.mock('@/lib/security/auditLog', () => ({ logSecurityEvent: vi.fn() }));

const path = 'https://crm.example/api/api-keys';
const post = (body: string, origin = 'https://crm.example') => POST(new Request(path, {
  method: 'POST', body, headers: { origin, host: 'crm.example', 'x-forwarded-proto': 'https' },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthedAdmin).mockResolvedValue({ userId: 'actor', organizationId: 'org-da-aba' });
  from.mockReturnValue({ insert, select });
  insert.mockReturnValue({ select });
  select.mockReturnValue({ eq, single });
  eq.mockReturnValue({ order });
  order.mockResolvedValue({ data: [], error: null });
  single.mockResolvedValue({ data: { id: 'id', key_prefix: 'prefixo' }, error: null });
});

it.each([
  [{ name: 'legada' }, null],
  [{ accessMode: 'full' }, null],
  [{ accessMode: 'squad_read' }, ['ai_agents:read']],
  [{ accessMode: 'squad_prompt' }, ['ai_agents:read', 'ai_agents:write_prompt']],
])('grava uma chave independente com as permissões escolhidas', async (body, scopes) => {
  const response = await post(JSON.stringify(body));
  expect(response.status).toBe(201);
  expect(from).toHaveBeenCalledTimes(1);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ scopes, organization_id: 'org-da-aba', created_by: 'actor' }));
  expect(await response.json()).toEqual({ data: { id: 'id', key_prefix: 'prefixo', token: 'token-ficticio' } });
  expect(JSON.stringify(vi.mocked(logSecurityEvent).mock.calls[0][0])).not.toContain('token-ficticio');
});

it.each(['{', 'null', '{"accessMode":"todos"}', '{"scopes":[]}'])('recusa um perfil ou corpo inválido', async body => {
  expect((await post(body)).status).toBe(422);
  expect(insert).not.toHaveBeenCalled();
});

it('lista somente os metadados e os escopos da organização atual', async () => {
  expect((await GET()).status).toBe(200);
  expect(select).toHaveBeenCalledWith(API_KEY_COLUMNS);
  expect(API_KEY_COLUMNS.split(',')).toContain('scopes');
  expect(API_KEY_COLUMNS.split(',')).not.toContain('key_hash');
  expect(eq).toHaveBeenCalledWith('organization_id', 'org-da-aba');
});

it('exige administrador e mesma origem para criar', async () => {
  expect((await post('{}', 'https://other.example')).status).toBe(403);
  vi.mocked(getAuthedAdmin).mockResolvedValue({ error: 'Forbidden', status: 403 });
  expect((await post('{}')).status).toBe(403);
  expect(from).not.toHaveBeenCalled();
});
