/**
 * POST /api/security/login-failed  { email }
 *
 * A tela de login avisa aqui quando a senha é recusada, para a tentativa ficar
 * no registro de eventos críticos (o login em si é feito direto no Supabase
 * Auth, que não passa pelo servidor do CRM).
 *
 * É uma rota aberta (quem errou a senha não está logado), então:
 *  - grava no máximo 1 registro por minuto por IP e 20 por minuto no total da
 *    instância, para não virar porta de sobrecarga do banco;
 *  - guarda o e-mail mascarado e nunca a senha;
 *  - sempre responde igual, sem dizer se gravou.
 *
 * Quem ataca o Supabase Auth direto não passa por aqui: essas tentativas ficam
 * nos logs de Auth do painel do Supabase.
 */
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { logSecurityEvent, maskEmail, requestMeta, shouldLogThrottled } from '@/lib/security/auditLog';

export const runtime = 'nodejs';

const done = () => new Response(null, { status: 204 });
const GLOBAL_PER_MINUTE = 20;
let windowStart = 0;
let windowCount = 0;

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return done();
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return done();

  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  const { ip } = requestMeta(req);
  if (windowCount >= GLOBAL_PER_MINUTE) return done();
  if (!shouldLogThrottled(`auth.login_failed:${ip ?? 'sem-ip'}`, 60_000, now)) return done();
  windowCount += 1;

  await logSecurityEvent(
    {
      action: 'auth.login_failed',
      resourceType: 'auth',
      details: { email: maskEmail(email) },
      severity: 'warning',
    },
    req,
  );
  return done();
}
