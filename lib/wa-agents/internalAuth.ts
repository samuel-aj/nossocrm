/**
 * Autenticação das rotas internas (/api/wa-agents/ingest e /tick), chamadas
 * pelo banco (pg_net) e pelo pg_cron com o header X-Internal-Secret.
 *
 * O segredo é WA_AGENTS_INTERNAL_SECRET, dedicado a este módulo (o mesmo valor
 * gravado em platform_config.wa_agents_internal_secret). Não há mais reserva
 * para CRON_SECRET: um vazamento deste segredo não abre as rotas /api/cron/*.
 */
import { timingSafeEqual } from 'node:crypto';

let warnedMissing = false;

function expectedSecret(): string {
  const value = (process.env.WA_AGENTS_INTERNAL_SECRET || '').trim();
  if (!value && !warnedMissing) {
    warnedMissing = true;
    console.error('[wa-agents] WA_AGENTS_INTERNAL_SECRET não configurado: as rotas internas respondem 401');
  }
  return value;
}

/** true quando o header x-internal-secret bate com WA_AGENTS_INTERNAL_SECRET. false se o env não existe. */
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
