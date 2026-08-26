/**
 * PATCH /api/whatsapp/connection/forward: espelho do webhook (admin).
 *
 * O provedor (Meta ou Evolution) entrega os eventos de um número para UM
 * destino. Quando o escritório precisa do mesmo número em outro sistema (n8n,
 * outro CRM, automação), o NossoCRM fica com o webhook e REPASSA o payload
 * bruto para esta URL. Assim os dois recebem tudo, sem um "roubar" o webhook
 * do outro. Vale para todos os provedores:
 * - meta_cloud: repasse assinado com o app secret (x-hub-signature-256),
 *   igual ao que a Meta envia (Edge Function whatsapp-webhook-meta).
 * - evolution / evolution_business: repasse com X-Webhook-Secret (segredo da
 *   conexão), X-Connection-Id e X-Evolution-Event (Edge Function whatsapp-webhook).
 *
 * Body: { connectionId: string, url: string | null }  (null/'' = desligar)
 */
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { getConnectionByIdForOrg } from '@/lib/whatsapp/service';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  const body = (await req.json().catch(() => null)) as { connectionId?: string; url?: string | null } | null;
  const connectionId = (body?.connectionId || '').trim();
  const url = (body?.url || '').trim();
  if (!connectionId) return json({ error: 'connectionId é obrigatório' }, 400);

  const conn = await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, connectionId);
  if (!conn) return json({ error: 'Número não encontrado' }, 404);

  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return json({ error: 'URL inválida' }, 400);
    }
    if (parsed.protocol !== 'https:') return json({ error: 'A URL do espelho precisa ser https://' }, 400);
    if (url.length > 2000) return json({ error: 'URL longa demais' }, 400);
    const nosso = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    if (nosso && url.startsWith(nosso)) return json({ error: 'Essa URL é do próprio CRM' }, 400);
  }

  const { error } = await auth.admin
    .from('wa_connections')
    .update({ forward_webhook_url: url || null })
    .eq('id', conn.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, forwardWebhookUrl: url || null });
}
