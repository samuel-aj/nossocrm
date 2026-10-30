/**
 * POST /api/integrations/zapsign/webhook/[orgId]   (chamado pela ZapSign)
 *
 * Aceita o evento, confere o segredo do cabeçalho X-Webhook-Secret (definido
 * por nós ao cadastrar o webhook na ZapSign), guarda o evento (dedupe das
 * repetições) e responde 200 na hora; o processamento (arquivo assinado,
 * histórico, mover etapa) roda em seguida. Sem o segredo certo: 401.
 */
import { after } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { handleZapSignWebhook, loadZapSignSettings, webhookDedupeKey, type WebhookPayload } from '@/lib/zapsign/signatures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Ctx = { params: Promise<{ orgId: string }> };

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given.replace(/^Bearer\s+/i, '').trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request, ctx: Ctx) {
  const { orgId } = await ctx.params;
  if (!isValidUUID(orgId)) return json({ error: 'not found' }, 404);
  const admin = createStaticAdminClient();
  const settings = await loadZapSignSettings(admin, orgId);
  if (!settings) return json({ error: 'not found' }, 404);
  const given = req.headers.get('x-webhook-secret') ?? req.headers.get('authorization');
  if (!secretMatches(given, settings.webhook_secret)) return json({ error: 'unauthorized' }, 401);

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!payload || typeof payload !== 'object') return json({ error: 'invalid payload' }, 400);

  // Dedupe: a ZapSign reenvia quando não recebe 200
  const dedupe = webhookDedupeKey(payload);
  const { data: inserted } = await admin
    .from('zapsign_webhook_events')
    .insert({ organization_id: orgId, doc_token: payload.token ?? null, event_type: payload.event_type ?? null, dedupe_key: dedupe, payload })
    .select('id')
    .maybeSingle();
  if (!inserted) {
    const { data: prev } = await admin.from('zapsign_webhook_events').select('id, processed').eq('organization_id', orgId).eq('dedupe_key', dedupe).maybeSingle();
    if ((prev as { processed?: boolean } | null)?.processed) return json({ ok: true, duplicate: true });
  }
  const eventId = (inserted as { id: string } | null)?.id ?? null;

  after(async () => {
    try {
      const result = await handleZapSignWebhook(admin, orgId, payload);
      if (eventId) await admin.from('zapsign_webhook_events').update({ processed: true, error: result.action }).eq('id', eventId);
    } catch (err) {
      console.error('[zapsign/webhook] falha ao processar', err);
      if (eventId) await admin.from('zapsign_webhook_events').update({ processed: false, error: (err as Error).message }).eq('id', eventId);
    }
  });
  return json({ ok: true });
}

export async function GET() {
  return json({ ok: true, service: 'zapsign-webhook' });
}
