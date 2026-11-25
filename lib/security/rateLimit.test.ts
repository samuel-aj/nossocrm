import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inserts = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { resetAuditThrottle } from './auditLog';
import {
  LIMITS,
  enforceRateLimit,
  limitFromEnv,
  rateLimit,
  rateLimitHeaders,
  rateLimitPeek,
  resetRateLimits,
} from './rateLimit';

describe('limite de requisições', () => {
  beforeEach(() => {
    resetRateLimits();
    resetAuditThrottle();
    inserts.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('libera até o limite e recusa o excesso na mesma janela', () => {
    const now = 1_000_000;
    expect(rateLimit('k', 3, 60_000, now)).toMatchObject({ ok: true, remaining: 2 });
    expect(rateLimit('k', 3, 60_000, now + 1)).toMatchObject({ ok: true, remaining: 1 });
    expect(rateLimit('k', 3, 60_000, now + 2)).toMatchObject({ ok: true, remaining: 0 });
    const blocked = rateLimit('k', 3, 60_000, now + 30_000);
    expect(blocked).toMatchObject({ ok: false, remaining: 0, retryAfterSeconds: 30 });
    // outra chave não é afetada
    expect(rateLimit('outra', 3, 60_000, now).ok).toBe(true);
  });

  it('zera quando a janela vira', () => {
    const now = 2_000_000;
    rateLimit('k', 1, 60_000, now);
    expect(rateLimit('k', 1, 60_000, now + 59_999).ok).toBe(false);
    expect(rateLimit('k', 1, 60_000, now + 60_000).ok).toBe(true);
  });

  it('consulta sem contar', () => {
    const now = 3_000_000;
    expect(rateLimitPeek('k', 2, now)).toBeNull();
    rateLimit('k', 2, 60_000, now);
    expect(rateLimitPeek('k', 2, now)).toBeNull();
    rateLimit('k', 2, 60_000, now);
    expect(rateLimitPeek('k', 2, now)).toMatchObject({ ok: false });
    // consultar não consome: continua igual depois de várias consultas
    expect(rateLimitPeek('k', 2, now + 60_000)).toBeNull();
  });

  it('lê o limite da variável de ambiente e ignora valor inválido', () => {
    vi.stubEnv('RATE_LIMIT_AI', '7');
    expect(LIMITS.aiPerUser()).toBe(7);
    vi.stubEnv('RATE_LIMIT_AI', 'abc');
    expect(LIMITS.aiPerUser()).toBe(30);
    vi.stubEnv('RATE_LIMIT_AI', '0');
    expect(limitFromEnv('RATE_LIMIT_AI', 30)).toBe(30);
  });

  it('cabeçalhos informam o limite e, quando recusado, o tempo de espera', () => {
    const okHeaders = rateLimitHeaders({ ok: true, limit: 10, remaining: 9, retryAfterSeconds: 60 });
    expect(okHeaders).toEqual({ 'RateLimit-Limit': '10', 'RateLimit-Remaining': '9', 'RateLimit-Reset': '60' });
    expect(rateLimitHeaders({ ok: false, limit: 10, remaining: 0, retryAfterSeconds: 12 })['Retry-After']).toBe('12');
  });

  it('enforceRateLimit devolve 429 em português e registra o estouro uma vez', async () => {
    const req = new Request('https://crm.test/api/ai/chat', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    const call = () => enforceRateLimit({ scope: 'ai', id: 'u1', limit: 2, request: req, actorId: 'u1', organizationId: 'o1' });
    expect(await call()).toBeNull();
    expect(await call()).toBeNull();
    const res = await call();
    expect(res?.status).toBe(429);
    expect(res?.headers.get('Retry-After')).toBeTruthy();
    const body = await res!.json();
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.error).toMatch(/Muitas requisições/);
    expect(typeof body.retry_after).toBe('number');
    await call();
    await call();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      action: 'rate_limit.exceeded',
      severity: 'warning',
      user_id: 'u1',
      organization_id: 'o1',
      ip_address: '203.0.113.9',
      details: { limite: 'ai', por_minuto: 2, path: '/api/ai/chat' },
    });
  });
});
