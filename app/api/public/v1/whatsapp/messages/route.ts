/**
 * POST /api/public/v1/whatsapp/messages -> envia texto ou modelo pelo WhatsApp
 * da organização e GRAVA no chat do CRM (aparece no card do lead e em /chats).
 *
 * Feito pra agentes de IA (n8n/Make): o agente recebe as mensagens pelo webhook
 * de saída (eventos whatsapp.message.received / whatsapp.message.sent) e
 * responde por aqui. Mandar direto pela Graph API da Meta NÃO aparece no CRM.
 *
 * Body:
 *   { to: "+5569999999999",
 *     text?: "Olá!",
 *     template?: { name: "boas_vindas", language?: "pt_BR", params?: ["Maria"], components?: [...] },
 *     connection_id?: "uuid do número (GET /whatsapp/connections); omitido = padrão da org" }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/public-api/sanitize';
import { isValidUUID } from '@/lib/supabase/utils';
import { getProvider } from '@/lib/whatsapp';
import {
  ensureConversation,
  getConnectionByIdForOrg,
  getConnectionByOrg,
  recordOutboundMessage,
  replicateOutboundToSiblings,
} from '@/lib/whatsapp/service';
import { traduzErroWhatsApp } from '@/lib/whatsapp/metaErrorsPtBr';

export const runtime = 'nodejs';

const TemplateSchema = z.object({
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(16).optional(),
  /** Atalho: valores das variáveis {{1}}, {{2}}... do corpo, em ordem */
  params: z.array(z.string().max(1024)).max(20).optional(),
  /** Formato completo da Meta (header/body/buttons); quando vem, ignora `params` */
  components: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
});

const BodySchema = z.object({
  to: z.string().trim().min(5).max(32),
  text: z.string().trim().max(4096).optional(),
  template: TemplateSchema.optional(),
  connection_id: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', code: 'VALIDATION', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const to = normalizePhone(body.to);
  if (!to) return NextResponse.json({ error: 'Invalid phone in `to`', code: 'VALIDATION' }, { status: 400 });
  const text = body.text ?? '';
  if (!text && !body.template) {
    return NextResponse.json({ error: '`text` or `template` is required', code: 'VALIDATION' }, { status: 400 });
  }

  const connectionId = body.connection_id ?? '';
  if (connectionId && !isValidUUID(connectionId)) {
    return NextResponse.json({ error: 'Invalid `connection_id`', code: 'VALIDATION' }, { status: 400 });
  }

  const sb = createStaticAdminClient();
  const orgId = auth.organizationId;

  const conn = connectionId
    ? await getConnectionByIdForOrg(sb, orgId, connectionId)
    : await getConnectionByOrg(sb, orgId);
  if (!conn) {
    return NextResponse.json(
      {
        error: connectionId ? 'Connection not found' : 'No WhatsApp number connected in this organization',
        code: 'NO_CONNECTION',
      },
      { status: 404 }
    );
  }
  if (conn.status !== 'connected') {
    return NextResponse.json({ error: 'WhatsApp number is disconnected', code: 'DISCONNECTED' }, { status: 409 });
  }

  const provider = getProvider(conn);
  const conv = await ensureConversation(sb, orgId, conn.id, to);

  let result;
  let bodyText = text;
  if (body.template) {
    if (!provider.sendTemplate) {
      return NextResponse.json(
        { error: 'Templates are only available on official API (meta_cloud) connections', code: 'TEMPLATE_UNSUPPORTED' },
        { status: 400 }
      );
    }
    const params = body.template.params ?? [];
    const components =
      body.template.components ??
      (params.length ? [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: t })) }] : undefined);
    result = await provider.sendTemplate({
      to,
      name: body.template.name,
      language: body.template.language || 'pt_BR',
      components,
    });
    // O chat do CRM mostra QUAL modelo saiu (e as variáveis) em vez de vazio
    bodyText = text || `[Modelo: ${body.template.name}]${params.length ? ' ' + params.join(' | ') : ''}`;
  } else {
    result = await provider.sendText({ to, text });
  }

  const message = await recordOutboundMessage(sb, {
    orgId,
    conversationId: conv.id,
    text: bodyText,
    providerMessageId: result.providerMessageId,
    fromPhone: conn.phone_number,
    toPhone: to,
    sentBy: null,
    source: 'api',
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
  });

  if (result.ok) {
    await replicateOutboundToSiblings(sb, conn, {
      toPhone: to,
      text: message.body,
      providerMessageId: result.providerMessageId,
    });
  }

  const out = {
    id: message.id,
    status: message.status,
    provider_message_id: message.evolution_message_id,
    conversation_id: conv.id,
    connection_id: conn.id,
    to,
  };

  if (!result.ok) {
    const t = traduzErroWhatsApp(result.error || '');
    return NextResponse.json(
      { ok: false, error: result.error || 'Send failed', error_pt: t.explicacao, code: 'SEND_FAILED', message: out },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, message: out }, { status: 201 });
}
