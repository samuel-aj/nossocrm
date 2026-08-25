/**
 * Autenticação das rotas internas (/api/wa-agents/ingest e /tick), chamadas
 * pelo banco (pg_net) e pelo pg_cron com o header X-Internal-Secret.
 */
import { timingSafeEqual } from 'node:crypto';

function expectedSecret(): string {
  return (process.env.WA_AGENTS_INTERNAL_SECRET || process.env.CRON_SECRET || '').trim();
}

/** true quando o header x-internal-secret bate com o segredo do ambiente. false se o env não existe. */
export function verifyInternalSecret(req: Request): boolean {
  const expected = expectedSecret();
  if (!expected) return false;
  const given = (req.headers.get('x-internal-secret') || '').trim();
  if (!given) return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
