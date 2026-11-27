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
const allowed = ['list', 'get', 'conversations', 'transcript', 'versions.list', 'versions.get'].map(n => 'crm.ai_agents.' + n).sort();

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
  m.adminRpc.mockImplementation(async (name, args) => {
    if (name === 'aj_operator_authenticate') {
      return { data: !revoked && args.p_key_hash === hash ? keyId : null, error: null };
    }
    if (name === 'aj_operator_read') {
      return { data: { id: agent, system_prompt: 'Roteiro fictício' }, error: null };
    }
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
  expect(m.adminRpc.mock.calls.every(([name]) => name === 'aj_operator_authenticate')).toBe(true);
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
    ['aj_operator_authenticate', { p_key_hash: hash }], ['aj_operator_read', { p_key_id: keyId, p_tool: tool, p_args: args }],
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
  expect(m.adminRpc.mock.calls.every(([name]) => name === 'aj_operator_authenticate')).toBe(true);
});

it('honors revocation and content denials rechecked by Postgres and fails closed on audit failure', async () => {
  const request = () => call('tools/call', { name: 'crm.ai_agents.get', arguments: { agentId: agent } });
  const pass = { data: keyId, error: null };
  m.adminRpc.mockResolvedValueOnce(pass).mockResolvedValueOnce({ data: { code: 'AUTH_INVALID', error: 'Revoked' }, error: null });
  expect((await request()).status).toBe(401);
  m.adminRpc.mockResolvedValueOnce(pass).mockResolvedValueOnce({ data: { code: 'UNAVAILABLE', error: 'Indisponível' }, error: null });
  expect(await (await request()).json()).toMatchObject({ result: { isError: true, structuredContent: { code: 'UNAVAILABLE' } } });
  m.adminRpc.mockResolvedValueOnce(pass).mockResolvedValueOnce({ data: null, error: { message: 'private audit detail' } });
  const failed = await (await request()).json();
  expect(failed).toMatchObject({ result: { isError: true, structuredContent: { code: 'AI_AGENTS_UNAVAILABLE' } } });
  expect(JSON.stringify(failed)).not.toContain('private audit detail');
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
