/**
 * /api/integrations/api4com/me  (qualquer membro: é a conexão DELE)
 *   GET    -> { connected:false } | { connected:true, name, email, extension, webhook_ok, ... }
 *   PUT    -> { api_token }  valida o token na API4com, descobre o ramal e
 *             cadastra o webhook de retorno apontando para este CRM.
 *   DELETE -> desconecta (apaga o webhook lá e o token aqui).
 * O token nunca volta inteiro para o navegador.
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { guardRoute, readJsonBody, validationError, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { connectUser, disconnectUser, loadUserSettings, publicView } from '@/lib/api4com/calls';
import { Api4comError } from '@/lib/api4com/client';

export const runtime = 'nodejs';

const Body = z.object({ api_token: z.string().trim().min(8).max(500) });

/**
 * URL pública deste CRM para a API4com chamar de volta: o endereço pelo qual a
 * requisição chegou (produção, prévia ou local). A API4com não manda cabeçalho
 * próprio, então o segredo vai na URL; na prévia protegida da Vercel, o
 * bypass também vai na URL.
 */
function webhookUrlFor(req: Request, orgId: string, secret: string): string {
  const url = new URL(req.url);
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host).split(',')[0].trim();
  const proto = (req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')).split(',')[0].trim();
  let out = `${proto}://${host}/api/integrations/api4com/webhook/${orgId}/${secret}`;
  const bypass = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
  if (bypass) out += `?x-vercel-protection-bypass=${encodeURIComponent(bypass)}`;
  return out;
}

export async function GET() {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;
  try {
    const row = await loadUserSettings(auth.admin, auth.user.organizationId, auth.user.id);
    return json(row ? publicView(row) : { connected: false });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao ler a configuração') }, 500);
  }
}

export async function PUT(req: Request) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const orgId = auth.user.organizationId;
  try {
    const row = await connectUser(auth.admin, { orgId, userId: auth.user.id, token: parsed.data.api_token, webhookUrlFor: (secret) => webhookUrlFor(req, orgId, secret) });
    return json(publicView(row));
  } catch (err) {
    if (err instanceof Api4comError) {
      if (err.status === 401 || err.status === 403) return json({ error: 'A API4com não aceitou o token. Confira se copiou o token de acesso inteiro, do seu usuário.' }, 400);
      if (err.code === 'NO_EXTENSION') return json({ error: err.message }, 400);
      if (err.code === 'PENDING_MIGRATION') return json({ error: err.message }, 503);
      return json({ error: `Não foi possível conectar: ${err.message}` }, 502);
    }
    return json({ error: getErrorMessage(err, 'Falha ao conectar') }, 500);
  }
}

export async function DELETE(req: Request) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;
  try {
    await disconnectUser(auth.admin, { orgId: auth.user.organizationId, userId: auth.user.id });
    return json({ connected: false });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao desconectar') }, 500);
  }
}
