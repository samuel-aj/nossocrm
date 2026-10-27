/**
 * /api/integrations/zapsign/settings  (admin da organização)
 *   GET    -> { connected, sandbox, token_hint, template_count, verified_at, webhook_ok, last_error }
 *   PUT    -> { api_token, sandbox }  testa o token (lista os modelos), cria o
 *             webhook da conta na ZapSign apontando para este CRM e grava.
 *   DELETE -> desconecta (apaga o webhook lá e o token aqui).
 * O token nunca volta inteiro para o navegador.
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { guardRoute, readJsonBody, validationError, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { clientFor, loadZapSignSettings, newWebhookSecret } from '@/lib/zapsign/signatures';
import { ZapSignError } from '@/lib/zapsign/client';

export const runtime = 'nodejs';

const Body = z.object({
  api_token: z.string().trim().min(8).max(400),
  sandbox: z.boolean().optional().default(false),
});

function hint(token: string): string {
  return token.length <= 8 ? '****' : `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * URL pública deste CRM para a ZapSign chamar de volta: o endereço pelo qual
 * esta requisição chegou (produção, prévia da Vercel ou local), não um
 * endereço fixo, para a prévia não cadastrar o webhook apontando para produção.
 */
function webhookUrlFor(req: Request, orgId: string): string {
  const url = new URL(req.url);
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host).split(',')[0].trim();
  const proto = (req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')).split(',')[0].trim();
  return `${proto}://${host}/api/integrations/zapsign/webhook/${orgId}`;
}

export async function GET() {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  try {
    const s = await loadZapSignSettings(auth.admin, auth.user.organizationId);
    if (!s) return json({ connected: false });
    return json({
      connected: true,
      sandbox: s.sandbox,
      token_hint: hint(s.api_token),
      template_count: s.template_count,
      verified_at: s.verified_at,
      webhook_ok: !!s.webhook_id,
      webhook_url: s.webhook_url,
      last_error: s.last_error,
    });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao ler a configuração') }, 500);
  }
}

export async function PUT(req: Request) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const orgId = auth.user.organizationId;
  const input = parsed.data;

  const client = clientFor({ api_token: input.api_token, sandbox: input.sandbox });
  let templateCount = 0;
  try {
    templateCount = (await client.listTemplates()).length;
  } catch (err) {
    const e = err as ZapSignError;
    return json({ error: `Não foi possível conectar: ${e.message}` }, e instanceof ZapSignError && (e.status === 401 || e.status === 403) ? 400 : 502);
  }

  const existing = await loadZapSignSettings(auth.admin, orgId);
  // Reaproveita o segredo quando o token é o mesmo (webhook já cadastrado continua válido)
  const sameAccount = existing && existing.api_token === input.api_token && existing.sandbox === input.sandbox;
  const secret = sameAccount ? existing.webhook_secret : newWebhookSecret();
  const url = webhookUrlFor(req, orgId);

  let webhookId: string | null = sameAccount && existing.webhook_url === url ? existing.webhook_id : null;
  let webhookError: string | null = null;
  if (!webhookId) {
    // conta trocou ou URL mudou: apaga o antigo (se der) e cria um novo
    if (existing?.webhook_id && sameAccount) {
      try {
        await client.deleteWebhook(existing.webhook_id);
      } catch {
        /* pode já não existir */
      }
    }
    const headers = [{ name: 'X-Webhook-Secret', value: secret }];
    // Prévia da Vercel com proteção: o cabeçalho de bypass deixa a ZapSign entrar
    const bypass = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
    if (bypass) headers.push({ name: 'x-vercel-protection-bypass', value: bypass });
    try {
      const wh = await client.createWebhook({ url, type: '', headers });
      webhookId = wh?.id != null ? String(wh.id) : null;
      if (!webhookId) webhookError = 'a ZapSign não devolveu o id do webhook';
    } catch (err) {
      webhookError = (err as Error).message;
    }
  }

  const row = {
    organization_id: orgId,
    api_token: input.api_token,
    sandbox: input.sandbox,
    webhook_id: webhookId,
    webhook_url: url,
    webhook_secret: secret,
    template_count: templateCount,
    verified_at: new Date().toISOString(),
    last_error: webhookError,
    created_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await auth.admin.from('zapsign_settings').upsert(row, { onConflict: 'organization_id' });
  if (error) {
    if (/zapsign_settings/.test(error.message)) return json({ error: 'A integração com a ZapSign ainda não foi instalada no banco. Fale com o suporte.' }, 503);
    return json({ error: error.message }, 500);
  }
  return json({
    connected: true,
    sandbox: input.sandbox,
    token_hint: hint(input.api_token),
    template_count: templateCount,
    verified_at: row.verified_at,
    webhook_ok: !!webhookId,
    webhook_url: url,
    last_error: webhookError,
  });
}

export async function DELETE(req: Request) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;
  const existing = await loadZapSignSettings(auth.admin, orgId);
  if (existing?.webhook_id) {
    try {
      await clientFor(existing).deleteWebhook(existing.webhook_id);
    } catch {
      /* segue: o segredo muda e o webhook antigo passa a ser recusado */
    }
  }
  await auth.admin.from('zapsign_settings').delete().eq('organization_id', orgId);
  return json({ connected: false });
}
