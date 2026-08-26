/**
 * Autenticação das rotas internas (/api/wa-agents/ingest e /tick), chamadas
 * pelo banco (pg_net) e pelo pg_cron com o header X-Internal-Secret.
 *
 * O segredo esperado é WA_AGENTS_INTERNAL_SECRET (dedicado a este módulo, o
 * mesmo valor gravado em platform_config.wa_agents_internal_secret). Quando
 * essa variável não existe, vale CRON_SECRET como reserva: é o valor que a
 * instalação em produção gravou no banco. Com a variável dedicada definida,
 * a reserva deixa de valer (um vazamento dela não abre as rotas /api/cron/*).
 */
import { timingSafeEqual } from 'node:crypto';

let warnedMissing = false;

function expectedSecret(): string {
  const dedicated = (process.env.WA_AGENTS_INTERNAL_SECRET || '').trim();
  if (dedicated) return dedicated;
  const fallback = (process.env.CRON_SECRET || '').trim();
  if (!fallback && !warnedMissing) {
    warnedMissing = true;
    console.error('[wa-agents] WA_AGENTS_INTERNAL_SECRET (ou CRON_SECRET) não configurado: as rotas internas respondem 401');
  }
  return fallback;
}

/**
 * true quando o header x-internal-secret bate com WA_AGENTS_INTERNAL_SECRET
 * (ou, na falta dela, com CRON_SECRET). false se nenhum dos dois existe.
 */
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
