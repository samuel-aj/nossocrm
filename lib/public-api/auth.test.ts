import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rpcCalls: 0,
  inserts: [] as Array<Record<string, unknown>>,
  valid: new Map<string, { api_key_id: string; api_key_prefix: string; organization_id: string; organization_name: string }>(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (_fn: string, args: { p_token: string }) => ({
      maybeSingle: async () => {
        state.rpcCalls += 1;
        return { data: state.valid.get(args.p_token) ?? null, error: null };
      },
    }),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        state.inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { authPublicApi } from './auth';
import { resetAuditThrottle } from '@/lib/security/auditLog';
import { resetRateLimits } from '@/lib/security/rateLimit';

const req = (key: string, ip = '203.0.113.20') =>
  new Request('https://crm.test/api/public/v1/deals', { headers: { 'x-api-key': key, 'x-forwarded-for': ip } });

describe('limites da API pública', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('RATE_LIMIT_PUBLIC_API', '3');
    vi.stubEnv('RATE_LIMIT_PUBLIC_API_INVALID', '2');
    state.rpcCalls = 0;
    state.inserts = [];
    state.valid.clear();
    state.valid.set('boa', { api_key_id: 'k1', api_key_prefix: 'ncrm_abc', organization_id: 'o1', organization_name: 'Org' });
    state.valid.set('outra', { api_key_id: 'k2', api_key_prefix: 'ncrm_def', organization_id: 'o2', organization_name: 'Org 2' });
    resetRateLimits();
    resetAuditThrottle();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('chave válida passa até o limite por minuto e depois recebe 429', async () => {
    for (let i = 0; i < 3; i++) expect((await authPublicApi(req('boa'))).ok).toBe(true);
    const blocked = await authPublicApi(req('boa'));
    expect(blocked).toMatchObject({ ok: false, status: 429, body: { code: 'RATE_LIMITED' } });
    if (!blocked.ok) {
      expect(blocked.headers?.['Retry-After']).toBeTruthy();
      expect(blocked.body.retry_after).toBeGreaterThan(0);
    }
    // o limite é por chave: a outra integração segue normal
    expect((await authPublicApi(req('outra'))).ok).toBe(true);
    // o estouro fica registrado uma vez, com a organização da chave
    const logged = state.inserts.filter(r => r.action === 'rate_limit.exceeded');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ organization_id: 'o1', details: { limite: 'public_api', por_minuto: 3 } });
  });

  it('IP que insiste em chave inválida é bloqueado sem ir ao banco', async () => {
    expect(await authPublicApi(req('errada-1', '203.0.113.30'))).toMatchObject({ status: 401 });
    expect(await authPublicApi(req('errada-2', '203.0.113.30'))).toMatchObject({ status: 401 });
    const callsBefore = state.rpcCalls;
    expect(await authPublicApi(req('errada-3', '203.0.113.30'))).toMatchObject({ status: 429 });
    // nem a chave boa passa desse IP enquanto durar o bloqueio
    expect(await authPublicApi(req('boa', '203.0.113.30'))).toMatchObject({ status: 429 });
    expect(state.rpcCalls).toBe(callsBefore);
    // outro IP não é afetado
    expect((await authPublicApi(req('boa', '203.0.113.31'))).ok).toBe(true);
  });

  it('sem chave continua 401 e não conta', async () => {
    const res = await authPublicApi(new Request('https://crm.test/api/public/v1/deals'));
    expect(res).toMatchObject({ ok: false, status: 401, body: { code: 'AUTH_MISSING' } });
    expect(state.rpcCalls).toBe(0);
  });
});
