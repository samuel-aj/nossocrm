import { logSecurityEvent, requestMeta, shouldLogThrottled } from '@/lib/security/auditLog';

/**
 * Limite de requisições (item "governança e limitações de APIs" da auditoria de
 * segurança de 23/11/2026).
 *
 * Conta os pedidos de cada chave ("quem" + "o quê") numa janela fixa e recusa
 * o excesso com 429. A contagem fica na memória da instância do servidor: não
 * custa nenhuma ida ao banco (que já sofreu com sobrecarga) e segura o caso
 * real, que é um cliente em laço ou um script abusando. Como a Vercel pode
 * manter mais de uma instância no ar, o teto efetivo pode passar um pouco do
 * número configurado; o objetivo é conter abuso, não cobrar por cota exata.
 *
 * Quem estoura fica registrado no painel de segurança (no máximo um registro
 * por minuto por chave).
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Segundos até a janela zerar. */
  retryAfterSeconds: number;
};

function prune(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  if (buckets.size >= MAX_BUCKETS) buckets.clear();
}

/** Conta um pedido da chave e diz se ele cabe no limite da janela. */
export function rateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    prune(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Consulta sem contar: a chave já passou do limite nesta janela? */
export function rateLimitPeek(key: string, limit: number, now = Date.now()): RateLimitResult | null {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now || bucket.count < limit) return null;
  return { ok: false, limit, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

/** Só para testes. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Limite vindo de variável de ambiente (inteiro positivo), com padrão. */
export function limitFromEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Limites padrão por minuto. Cada um pode ser ajustado por variável de ambiente. */
export const LIMITS = {
  /** API pública, por chave de API. */
  publicApiPerKey: () => limitFromEnv('RATE_LIMIT_PUBLIC_API', 600),
  /** API pública, tentativas com chave inválida, por IP. */
  publicApiInvalidPerIp: () => limitFromEnv('RATE_LIMIT_PUBLIC_API_INVALID', 20),
  /** Rotas que gastam a chave de IA da organização, por usuário. */
  aiPerUser: () => limitFromEnv('RATE_LIMIT_AI', 30),
  /** Envio e encaminhamento de mensagens do WhatsApp, por usuário. */
  whatsappSendPerUser: () => limitFromEnv('RATE_LIMIT_WHATSAPP_SEND', 120),
  /** Convites (validar e aceitar), por IP. Rota aberta. */
  invitesPerIp: () => limitFromEnv('RATE_LIMIT_INVITES', 20),
  /** Exportação de contatos, por usuário. */
  exportPerUser: () => limitFromEnv('RATE_LIMIT_EXPORT', 6),
};

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.retryAfterSeconds),
  };
  if (!result.ok) headers['Retry-After'] = String(result.retryAfterSeconds);
  return headers;
}

export function rateLimitMessage(result: RateLimitResult): string {
  return `Muitas requisições em pouco tempo. Tente novamente em ${result.retryAfterSeconds} segundos.`;
}

/** Resposta 429 pronta, no formato das rotas internas ({ error }). */
export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: rateLimitMessage(result), code: 'RATE_LIMITED', retry_after: result.retryAfterSeconds }),
    {
      status: 429,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...rateLimitHeaders(result) },
    },
  );
}

type Scope = {
  /** Nome curto do limite (vai para o registro), ex.: "ai", "public_api". */
  scope: string;
  /** Quem está sendo contado: id do usuário, id da chave de API ou IP. */
  id: string;
  limit: number;
  windowMs?: number;
  request?: Request | null;
  actorId?: string | null;
  organizationId?: string | null;
};

/** Registra o estouro no painel de segurança, no máximo uma vez por minuto por chave. */
export async function logRateLimitExceeded(input: Scope, result: RateLimitResult): Promise<void> {
  if (!shouldLogThrottled(`rate_limit:${input.scope}:${input.id}`)) return;
  await logSecurityEvent(
    {
      action: 'rate_limit.exceeded',
      actorId: input.actorId ?? null,
      organizationId: input.organizationId ?? null,
      resourceType: 'api',
      details: { limite: input.scope, por_minuto: result.limit, path: safePath(input.request) },
      severity: 'warning',
    },
    input.request,
  );
}

function safePath(request?: Request | null): string | null {
  if (!request) return null;
  try {
    return new URL(request.url).pathname.slice(0, 200);
  } catch {
    return null;
  }
}

/**
 * Conta o pedido e devolve a resposta 429 quando passou do limite (ou null
 * quando pode seguir). Uso nas rotas:
 *
 *   const limited = await enforceRateLimit({ scope: 'ai', id: user.id, limit: LIMITS.aiPerUser(), request: req });
 *   if (limited) return limited;
 */
export async function enforceRateLimit(input: Scope): Promise<Response | null> {
  const result = rateLimit(`${input.scope}:${input.id}`, input.limit, input.windowMs);
  if (result.ok) return null;
  await logRateLimitExceeded(input, result);
  return tooManyRequests(result);
}

/** IP do pedido para limites de rotas abertas ("sem-ip" quando a plataforma não informa). */
export function clientIp(request: Request): string {
  return requestMeta(request).ip ?? 'sem-ip';
}
