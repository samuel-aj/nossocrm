/**
 * POST /api/integrations/api4com/webhook/[orgId]/[secret]   (chamado pela API4com)
 *
 * A API4com não manda cabeçalho próprio, então o segredo (um por usuário
 * conectado) vai na URL. Guarda o evento (dedupe: id da chamada + tipo),
 * responde 200 na hora e processa em seguida (estado da ligação, histórico).
 * Ligação que teve conversa e gravação é transcrita em seguida (o texto
 * alimenta a IA que preenche o contrato), só nas organizações com a ZapSign
 * conectada, que são as que usam o texto.
 */
import { after } from 'next/server';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { handleApi4comWebhook, redactWebhookPayload, webhookDedupeKey, type WebhookPayload } from '@/lib/api4com/calls';
import { transcribeAfterHangup } from '@/lib/api4com/transcript';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ orgId: string; secret: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { orgId, secret } = await ctx.params;
  if (!isValidUUID(orgId) || !secret || secret.length < 16 || secret.length > 128) return json({ error: 'not found' }, 404);
  const admin = createStaticAdminClient();
  const { data: owner } = await admin.from('api4com_user_settings').select('user_id').eq('organization_id', orgId).eq('webhook_secret', secret).maybeSingle();
  if (!owner) return json({ error: 'not found' }, 404);

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!payload || typeof payload !== 'object') return json({ error: 'invalid payload' }, 400);

  const dedupe = webhookDedupeKey(payload);
  const { data: inserted } = await admin
    .from('api4com_webhook_events')
    .insert({ organization_id: orgId, dedupe_key: dedupe, event_type: payload.eventType ?? null, call_id: payload.id ?? null, payload: redactWebhookPayload(payload) })
    .select('id')
    .maybeSingle();
  if (!inserted) {
    const { data: prev } = await admin.from('api4com_webhook_events').select('id, processed').eq('organization_id', orgId).eq('dedupe_key', dedupe).maybeSingle();
    if ((prev as { processed?: boolean } | null)?.processed) return json({ ok: true, duplicate: true });
  }
  const eventId = (inserted as { id: string } | null)?.id ?? null;

  after(async () => {
    try {
      const result = await handleApi4comWebhook(admin, orgId, payload);
      if (eventId) await admin.from('api4com_webhook_events').update({ processed: true, error: result.action }).eq('id', eventId);
      if (payload.eventType === 'channel-hangup' && Number(payload.duration ?? 0) > 0 && payload.recordUrl) {
        const { data: zapsign } = await admin.from('zapsign_settings').select('organization_id').eq('organization_id', orgId).maybeSingle();
        if (zapsign) await transcribeAfterHangup(admin, orgId, payload);
      }
    } catch (err) {
      console.error('[api4com/webhook] falha ao processar', err);
      if (eventId) await admin.from('api4com_webhook_events').update({ processed: false, error: (err as Error).message }).eq('id', eventId);
    }
  });
  return json({ ok: true });
}

export async function GET() {
  return json({ ok: true, service: 'api4com-webhook' });
}
