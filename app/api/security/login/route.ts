/**
 * POST /api/security/login
 *
 * A tela de login chama aqui logo depois de entrar, para o acesso ficar no
 * registro de eventos críticos com usuário, hora e IP. O login em si é feito
 * direto no Supabase Auth, que não passa pelo servidor do CRM, e o histórico
 * dele não fica guardado no banco deste projeto.
 *
 * Só grava para quem tem sessão válida (o usuário vem do cookie, nunca do
 * corpo do pedido) e no máximo uma vez por minuto por usuário.
 */
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { logSecurityEvent, shouldLogThrottled } from '@/lib/security/auditLog';

export const runtime = 'nodejs';

const done = () => new Response(null, { status: 204 });

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return done();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return done();
  if (!shouldLogThrottled(`auth.login:${user.id}`)) return done();

  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).maybeSingle();
  await logSecurityEvent(
    {
      action: 'auth.login',
      actorId: user.id,
      organizationId: (profile as { organization_id?: string | null } | null)?.organization_id ?? null,
      resourceType: 'auth',
    },
    req,
  );
  return done();
}
