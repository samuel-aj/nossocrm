/**
 * POST /api/whatsapp/connection/resync — reconfigura o webhook na Meta usando
 * as credenciais JÁ SALVAS da conexão (admin).
 *
 * Serve pra aplicar mudanças na assinatura sem obrigar o admin a redigitar o
 * token permanente. Foi criada quando o campo `message_echoes` entrou: sem
 * reassinar, a Meta não avisa o que o número enviou fora do CRM (celular,
 * WhatsApp Web, outra ferramenta) e essas mensagens não aparecem no chat.
 */
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { getConnectionsByOrg } from '@/lib/whatsapp/service';
import { isMetaCloudConnection } from '@/lib/whatsapp';
import { setupMetaWebhooks } from '@/lib/whatsapp/metaCloudSetup';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  const body = (await req.json().catch(() => ({}))) as { connectionId?: string };

  const conns = (await getConnectionsByOrg(auth.admin, auth.user.organizationId)) ?? [];
  const alvos = conns.filter(
    c => isMetaCloudConnection(c) && (!body.connectionId || c.id === body.connectionId)
  );

  if (alvos.length === 0) {
    return json({ error: 'Nenhuma conexão de API oficial (Meta) nesta organização.' }, 400);
  }

  const supabaseBase = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const resultados: Array<{
    id: string;
    phone: string | null;
    ok: boolean;
    campoApp?: string;
    erro: string | null;
  }> = [];

  for (const conn of alvos) {
    if (!conn.instance_token || !conn.meta_waba_id) {
      resultados.push({
        id: conn.id,
        phone: conn.phone_number,
        ok: false,
        erro: 'Conexão sem token ou WABA salvos. Reconecte a API oficial nesta organização.',
      });
      continue;
    }

    const callbackUrl = `${supabaseBase}/functions/v1/whatsapp-webhook-meta/${conn.webhook_secret}`;
    const hooks = await setupMetaWebhooks({
      token: conn.instance_token,
      wabaId: conn.meta_waba_id,
      appId: conn.meta_app_id || null,
      appSecret: conn.meta_app_secret || null,
      callbackUrl,
      verifyToken: conn.webhook_secret,
    });

    resultados.push({
      id: conn.id,
      phone: conn.phone_number,
      // Recebimento garantido quando o callback exclusivo entrou OU o webhook
      // do app foi (re)configurado apontando pro CRM.
      ok: hooks.override || hooks.appWebhook === 'ok',
      campoApp: hooks.appWebhook,
      erro: hooks.appWebhookError || hooks.overrideError || hooks.subscribedError || null,
    });
  }

  return json({ ok: resultados.some(r => r.ok), resultados });
}
