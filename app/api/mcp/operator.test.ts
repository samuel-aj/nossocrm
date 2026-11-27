import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';
import { GET as publicMe } from '@/app/api/public/v1/me/route';
import { resetRateLimits } from '@/lib/security/rateLimit';

const m = vi.hoisted(() => ({
  adminRpc: vi.fn(), publicRpc: vi.fn(), resolveOwner: vi.fn(), crmTools: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({ rpc: m.adminRpc, from: () => ({ insert: vi.fn().mockResolvedValue({}) }) }),
}));
vi.mock('@supabase/supabase-js', async original => ({
  ...await original<typeof import('@supabase/supabase-js')>(), createClient: () => ({ rpc: m.publicRpc }),
}));
vi.mock('@/lib/mcp/whatsapp/access', async original => ({
  ...await original<typeof import('@/lib/mcp/whatsapp/access')>(), resolveMcpOwner: m.resolveOwner,
}));
vi.mock('@/lib/ai/tools', () => ({ createCRMTools: m.crmTools }));
vi.mock('@/lib/wa-agents/beta', () => ({ isAiAgentsApproved: async () => true }));

const operator = 'ncrmop_' + randomBytes(24).toString('base64url');
const ordinary = 'ncrm_' + randomBytes(24).toString('base64url');
const hash = createHash('sha256').update(operator).digest('hex');
const keyId = randomUUID(), orgKeyId = randomUUID(), org = randomUUID(), owner = randomUUID(), agent = randomUUID();
let revoked: boolean;
let scope: unknown;
const allowed = ['list', 'get', 'conversations', 'transcript', 'versions.list', 'versions.get'].map(n => 'crm.ai_agents.' + n).sort();
const feedbackTools = ['list', 'get', 'update'].map(n => 'crm.feedback.' + n).sort();
const onlyAuthentication = () => m.adminRpc.mock.calls.every(([name]) => name === 'aj_operator_authenticate_scoped');

function call(method: string, params = {}, token = operator, customHeaders = {}) {
  return POST(new Request('https://crm.test/api/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token, ...customHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture');
  resetRateLimits();
  revoked = false;
  scope = 'ai_agents_read';
  m.adminRpc.mockImplementation(async (name, args) => {
    if (name === 'aj_operator_authenticate_scoped') {
      return { data: !revoked && args.p_key_hash === hash ? [{ id: keyId, scope }] : [], error: null };
    }
    if (name === 'aj_operator_read') {
      return { data: { id: agent, system_prompt: 'Roteiro fictício' }, error: null };
    }
    if (name === 'aj_operator_feedback') return { data: { ok: true, status: 'corrigido' }, error: null };
    throw new Error('Unexpected RPC');
  });
  m.publicRpc.mockImplementation((_name, args) => ({ maybeSingle: async () => ({
    data: args.p_token === ordinary ? { api_key_id: orgKeyId, organization_id: org, organization_name: 'A',
      api_key_prefix: ordinary.slice(0, 12), scopes: ['ai_agents:read'] } : null, error: null,
  }) }));
  m.resolveOwner.mockResolvedValue({ id: owner, organizationId: org, role: 'admin' });
});
afterEach(() => vi.unstubAllEnvs());

it('discovers exactly six read-only tools, and never initializes a CRM or WhatsApp registry for the operator', async () => {
  const response = await call('tools/list');
  expect(response.status).toBe(200);
  const { result } = await response.json();
  expect(result.tools.map((t: { name: string }) => t.name).sort()).toEqual(allowed);
  expect(result.tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);
  for (const name of ['crm.ai_agents.prompt.update', 'crm.ai_agents.prompt.restore', 'crm.deals.create',
    'crm.whatsapp.uploads.prepare', 'crm.whatsapp.sequences.send', 'crm.ai_agents.unknown']) {
    const refused = await call('tools/call', { name, arguments: {} });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: -32602 } });
  }
  expect(onlyAuthentication()).toBe(true);
  expect(m.resolveOwner).not.toHaveBeenCalled();
  expect(m.publicRpc).not.toHaveBeenCalled();
  expect(m.crmTools).not.toHaveBeenCalled();
});

it('sends only the operator id, allowlisted tool and validated arguments to the guarded read', async () => {
  const tool = 'crm.ai_agents.get';
  const args = { agentId: agent };
  const read = await call('tools/call', { name: tool, arguments: args }, operator, { 'x-org-id': randomUUID() });
  expect(await read.json()).toMatchObject({ result: { structuredContent: { system_prompt: 'Roteiro fictício' } } });
  expect(m.adminRpc.mock.calls).toEqual([
    ['aj_operator_authenticate_scoped', { p_key_hash: hash }], ['aj_operator_read', { p_key_id: keyId, p_tool: tool, p_args: args }],
  ]);
  for (const extra of [{ organizationId: randomUUID() }, { keyId: randomUUID() }]) {
    const refused = await call('tools/call', { name: tool, arguments: { ...args, ...extra } });
    expect(await refused.json()).toMatchObject({ result: { isError: true } });
  }
  expect(m.adminRpc.mock.calls.filter(([name]) => name === 'aj_operator_read')).toHaveLength(1);
});

it('a revoked key fails on subsequent discovery, calls, ping and initialization', async () => {
  const queried = await call('tools/list');
  expect(queried.status).toBe(200);
  revoked = true;
  for (const method of ['tools/list', 'tools/call', 'ping', 'initialize']) {
    const res = await call(method, { name: 'crm.ai_agents.get', arguments: { agentId: agent } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { data: { code: 'AUTH_INVALID' } } });
  }
  expect(onlyAuthentication()).toBe(true);
});

it('honors revocation and content denials rechecked by Postgres and fails closed on audit failure', async () => {
  const request = () => call('tools/call', { name: 'crm.ai_agents.get', arguments: { agentId: agent } });
  const pass = { data: [{ id: keyId, scope: 'ai_agents_read' }], error: null };
  m.adminRpc.mockResolvedValueOnce(pass).mockResolvedValueOnce({ data: { code: 'AUTH_INVALID', error: 'Revoked' }, error: null });
  expect((await request()).status).toBe(401);
  m.adminRpc.mockResolvedValueOnce(pass).mockResolvedValueOnce({ data: { code: 'UNAVAILABLE', error: 'Indisponível' }, error: null });
  expect(await (await request()).json()).toMatchObject({ result: { isError: true, structuredContent: { code: 'UNAVAILABLE' } } });
  m.adminRpc.mockResolvedValueOnce(pass).mockResolvedValueOnce({ data: null, error: { message: 'private audit detail' } });
  const failed = await (await request()).json();
  expect(failed).toMatchObject({ result: { isError: true, structuredContent: { code: 'AI_AGENTS_UNAVAILABLE' } } });
  expect(JSON.stringify(failed)).not.toContain('private audit detail');
});

it('a chave da esteira só enxerga e chama crm.feedback.*, nunca as ferramentas de agentes', async () => {
  scope = 'feedback';
  const listed = await call('tools/list');
  expect(listed.status).toBe(200);
  const { result } = await listed.json();
  expect(result.tools.map((t: { name: string }) => t.name).sort()).toEqual(feedbackTools);
  for (const name of [...allowed, 'crm.ai_agents.prompt.update', 'crm.deals.create', 'crm.whatsapp.uploads.prepare']) {
    const refused = await call('tools/call', { name, arguments: { agentId: agent } });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: -32602, message: `Unknown tool: ${name}` } });
  }
  expect(onlyAuthentication()).toBe(true);
  const requestId = randomUUID();
  const updated = await call('tools/call', { name: 'crm.feedback.update', arguments: { requestId, status: 'corrigido' } });
  expect(await updated.json()).toMatchObject({ result: { structuredContent: { ok: true, status: 'corrigido' } } });
  expect(m.adminRpc.mock.calls.filter(([name]) => name !== 'aj_operator_authenticate_scoped')).toEqual([
    ['aj_operator_feedback', { p_key_id: keyId, p_tool: 'crm.feedback.update', p_args: { requestId, status: 'corrigido' } }],
  ]);
  // Revogada entre a autenticação e a chamada: o banco confere de novo e a rota devolve 401.
  m.adminRpc.mockResolvedValueOnce({ data: [{ id: keyId, scope: 'feedback' }], error: null })
    .mockResolvedValueOnce({ data: { code: 'AUTH_INVALID', error: 'Chave inválida.' }, error: null });
  expect((await call('tools/call', { name: 'crm.feedback.get', arguments: { requestId } })).status).toBe(401);
  expect(m.resolveOwner).not.toHaveBeenCalled();
  expect(m.publicRpc).not.toHaveBeenCalled();
  expect(m.crmTools).not.toHaveBeenCalled();
});

it('a chave de leitura de agentes e as chaves comuns não enxergam nem chamam crm.feedback.*', async () => {
  for (const token of [operator, ordinary]) {
    const listed = await (await call('tools/list', {}, token)).json();
    expect(listed.result.tools.some((t: { name: string }) => t.name.startsWith('crm.feedback.'))).toBe(false);
    for (const name of feedbackTools) {
      const refused = await call('tools/call', { name, arguments: { requestId: randomUUID(), status: 'descartado' } }, token);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: -32602, message: `Unknown tool: ${name}` } });
    }
  }
  expect(onlyAuthentication()).toBe(true);
});

it('nega o acesso quando não consegue ler o escopo da chave', async () => {
  const update = () => call('tools/call', { name: 'crm.feedback.update', arguments: { requestId: randomUUID(), status: 'descartado' } });
  // Escopo ausente, desconhecido ou no formato antigo (só o id) nunca vira chave da esteira.
  for (const data of [[{ id: keyId, scope: null }], [{ id: keyId, scope: 'admin' }], [{ id: keyId }], keyId, [{ scope: 'feedback' }], null]) {
    m.adminRpc.mockResolvedValueOnce({ data, error: null });
    const denied = await update();
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: { data: { code: 'AUTH_INVALID' } } });
  }
  m.adminRpc.mockResolvedValueOnce({ data: null, error: { message: 'function does not exist' } });
  expect((await update()).status).toBe(503);
  expect(onlyAuthentication()).toBe(true);
});

it('keeps ordinary keys on the organization validator, with the server-resolved owner and organization', async () => {
  const response = await call('tools/list', {}, ordinary, { 'x-org-id': randomUUID() });
  expect(response.status).toBe(200);
  expect(m.publicRpc).toHaveBeenCalledWith('validate_mcp_api_key', { p_token: ordinary });
  expect(m.resolveOwner).toHaveBeenCalledWith(expect.anything(), orgKeyId, org);
  expect(m.adminRpc).not.toHaveBeenCalled();
  expect((await response.json()).result.tools.map((t: {name: string}) => t.name).sort()).toEqual(allowed);
});

it('does not offer operator authentication in the public REST API', async () => {
  const response = await publicMe(new Request('https://crm.test/api/public/v1/me', { headers: { 'x-api-key': operator } }));
  expect(response.status).toBe(401);
  expect(m.publicRpc).toHaveBeenCalledWith('validate_api_key', { p_token: operator });
  expect(m.adminRpc).not.toHaveBeenCalled();
});

it('limits operator requests without consuming the per-key quota of an ordinary integration', async () => {
  vi.stubEnv('RATE_LIMIT_PUBLIC_API', '1');
  expect((await call('ping')).status).toBe(200);
  const limited = await call('tools/list');
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).toBeTruthy();
  expect((await call('ping', {}, ordinary)).status).toBe(200);
});

it('stops repeated attempts with revoked operator keys before querying the database again', async () => {
  vi.stubEnv('RATE_LIMIT_PUBLIC_API_INVALID', '2');
  revoked = true;
  expect((await call('ping')).status).toBe(401);
  expect((await call('ping')).status).toBe(401);
  expect((await call('ping')).status).toBe(429);
  expect(m.adminRpc).toHaveBeenCalledTimes(2);
});
