/**
 * POST /api/integrations/api4com/sip  (membro com a API4com conectada)
 *   -> { wsUrl, uri, username, password, realm }
 * Dados do ramal da PRÓPRIA pessoa para o telefone embutido no CRM se registrar
 * na central da API4com. Lidos na hora com o token dela; nada fica em cache.
 */
import { guardRoute, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { sipCredentials } from '@/lib/api4com/calls';
import { Api4comError } from '@/lib/api4com/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Senha do ramal: nunca pode ficar em cache de navegador ou de proxy. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0' },
  });
}

export async function POST(req: Request) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;
  try {
    const creds = await sipCredentials(auth.admin, { orgId: auth.user.organizationId, userId: auth.user.id });
    return json(creds, 200);
  } catch (err) {
    if (err instanceof Api4comError) {
      if (err.status === 401 || err.status === 403) {
        return json({ error: 'O token da API4com não vale mais. Conecte de novo em Configurações > Geral.', code: 'TOKEN_INVALID' }, 409);
      }
      const status = err.code === 'NOT_CONNECTED' ? 409 : err.status >= 400 && err.status < 600 ? err.status : 502;
      return json({ error: err.message, code: err.code }, status);
    }
    return json({ error: getErrorMessage(err, 'Falha ao ler o ramal') }, 500);
  }
}
