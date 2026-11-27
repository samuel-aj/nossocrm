import 'server-only';
import { createHash } from 'node:crypto';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { logSecurityEvent, shouldLogThrottled } from '@/lib/security/auditLog';
import {
  clientIp, LIMITS, logRateLimitExceeded, rateLimit, rateLimitHeaders, rateLimitMessage,
  rateLimitPeek, type RateLimitResult,
} from '@/lib/security/rateLimit';
import type { PublicApiAuthResult } from '@/lib/public-api/auth';

type OperatorAuth = Extract<PublicApiAuthResult, { ok: false }>
  | { ok: true; kind: 'operator'; apiKeyId: string };

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
  if (/^ncrmop_[A-Za-z0-9_-]{32,64}$/.test(token)) {
    const hash = createHash('sha256').update(token).digest('hex');
    try {
      const { data, error } = await createStaticAdminClient().rpc('aj_operator_authenticate', { p_key_hash: hash });
      if (error) throw error;
      if (typeof data === 'string') keyId = data;
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
  return { ok: true, kind: 'operator', apiKeyId: keyId };
}
