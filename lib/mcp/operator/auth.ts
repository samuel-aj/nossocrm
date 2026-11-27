import 'server-only';
import { createHash } from 'node:crypto';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { logSecurityEvent, shouldLogThrottled } from '@/lib/security/auditLog';
import {
  clientIp, LIMITS, logRateLimitExceeded, rateLimit, rateLimitHeaders, rateLimitMessage,
  rateLimitPeek, type RateLimitResult,
} from '@/lib/security/rateLimit';
import type { PublicApiAuthResult } from '@/lib/public-api/auth';

export type OperatorScope = 'ai_agents_read' | 'feedback';
/** Função inexistente: PostgREST (fora do cache de esquema) ou Postgres (undefined_function). */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);
type OperatorAuth = Extract<PublicApiAuthResult, { ok: false }>
  | { ok: true; kind: 'operator'; apiKeyId: string; scope: OperatorScope };

function limited(result: RateLimitResult): OperatorAuth {
  return { ok: false, status: 429, headers: rateLimitHeaders(result), body: {
    code: 'RATE_LIMITED', error: rateLimitMessage(result), retry_after: result.retryAfterSeconds,
  } };
}

export async function authenticateOperator(request: Request, token: string): Promise<OperatorAuth> {
  const ip = clientIp(request);
  const ipBucket = `operator_mcp_invalid:${ip}`;
  const invalidLimit = LIMITS.publicApiInvalidPerIp();
  const blocked = rateLimitPeek(ipBucket, invalidLimit);
  if (blocked) {
    await logRateLimitExceeded({ scope: 'operator_mcp_invalid', id: ip, limit: invalidLimit, request }, blocked);
    return limited(blocked);
  }

  let keyId: string | null = null;
  let scope: OperatorScope = 'ai_agents_read';
  if (/^ncrmop_[A-Za-z0-9_-]{32,64}$/.test(token)) {
    const hash = createHash('sha256').update(token).digest('hex');
    try {
      const admin = createStaticAdminClient();
      const { data, error } = await admin.rpc('aj_operator_authenticate_scoped', { p_key_hash: hash });
      if (error && MISSING_FUNCTION.has(error.code)) {
        // Código no ar antes da migração 20261128120200: a função antiga só conhece chaves
        // de leitura de agentes, então a chave nunca vira chave da esteira por aqui.
        const legacy = await admin.rpc('aj_operator_authenticate', { p_key_hash: hash });
        if (legacy.error) throw legacy.error;
        if (typeof legacy.data === 'string') keyId = legacy.data;
      } else {
        if (error) throw error;
        // Sem um escopo conhecido, a chave é recusada: nunca vira chave da esteira por padrão.
        const row = Array.isArray(data) ? data[0] : null;
        if (row && typeof row.id === 'string' && (row.scope === 'ai_agents_read' || row.scope === 'feedback')) { keyId = row.id; scope = row.scope; }
      }
    } catch {
      return { ok: false, status: 503, body: { code: 'AUTH_UNAVAILABLE', error: 'Authentication unavailable' } };
    }
  }
  if (!keyId) {
    rateLimit(ipBucket, invalidLimit);
    if (shouldLogThrottled(ipBucket)) {
      await logSecurityEvent({ action: 'public_api.invalid_key', resourceType: 'operator_key',
        severity: 'warning', details: { path: '/api/mcp' } }, request);
    }
    return { ok: false, status: 401, body: { code: 'AUTH_INVALID', error: 'Invalid API key' } };
  }

  const limit = LIMITS.publicApiPerKey();
  const usage = rateLimit(`operator_mcp:${keyId}`, limit);
  if (!usage.ok) {
    await logRateLimitExceeded({ scope: 'operator_mcp', id: keyId, limit, request }, usage);
    return limited(usage);
  }
  return { ok: true, kind: 'operator', apiKeyId: keyId, scope };
}
