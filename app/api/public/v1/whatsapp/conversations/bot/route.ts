/**
 * POST /api/public/v1/whatsapp/conversations/bot -> inicia ou para um ROBÔ de
 * atendimento numa conversa, pelo telefone do contato.
 *
 * Mesmo efeito do menu Automações do chat: ao iniciar, o agente de IA que
 * estiver atendendo aquela conversa é parado (robô e agente não falam juntos);
 * ao parar, só o robô é cancelado — o agente fica como está.
 *
 * Body:
 *   { phone: "+5569999999999",
 *     action: "start" | "stop",
 *     bot_id?: "uuid do robô (obrigatório em start; GET /whatsapp/bots)",
 *     context?: "texto que o robô e o agente leem como contexto da equipe",
 *     connection_id?: "uuid do número (GET /whatsapp/connections); omitido = padrão da org" }
 */
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { normalizePhone } from '@/lib/public-api/sanitize';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/supabase/utils';
import { isWaAgentsBetaEnabled } from '@/lib/wa-agents/beta';
import { applyConversationAction } from '@/lib/wa-agents/conversation';
import { runBotRunNow } from '@/lib/wa-agents/bots';
import { ensureConversation, getConnectionByIdForOrg, getConnectionByOrg } from '@/lib/whatsapp/service';

export const runtime = 'nodejs';
/** Os primeiros passos do robô rodam em after() dentro deste teto */
export const maxDuration = 120;

const BodySchema = z.object({
  phone: z.string().trim().min(5).max(32),
  action: z.enum(['start', 'stop']),
  bot_id: z.string().trim().optional(),
  context: z.string().trim().max(2000).optional(),
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

  const phone = normalizePhone(body.phone);
  if (!phone) return NextResponse.json({ error: 'Invalid phone in `phone`', code: 'VALIDATION' }, { status: 400 });

  if (body.action === 'start' && !body.bot_id) {
    return NextResponse.json({ error: '`bot_id` is required for action "start"', code: 'VALIDATION' }, { status: 400 });
  }
  if (body.bot_id && !isValidUUID(body.bot_id)) {
    return NextResponse.json({ error: 'Invalid `bot_id`', code: 'VALIDATION' }, { status: 400 });
  }
  const connectionId = body.connection_id ?? '';
  if (connectionId && !isValidUUID(connectionId)) {
    return NextResponse.json({ error: 'Invalid `connection_id`', code: 'VALIDATION' }, { status: 400 });
  }

  const sb = createStaticAdminClient();
  const organizationId = auth.organizationId;

  if (!(await isWaAgentsBetaEnabled(sb, organizationId))) {
    return NextResponse.json(
      { error: 'Robôs de atendimento não estão ligados nesta organização', code: 'AGENTS_OFF' },
      { status: 409 }
    );
  }

  const conn = connectionId
    ? await getConnectionByIdForOrg(sb, organizationId, connectionId)
    : await getConnectionByOrg(sb, organizationId);
  if (!conn) {
    return NextResponse.json(
      {
        error: connectionId ? 'Connection not found' : 'No WhatsApp number connected in this organization',
        code: 'NO_CONNECTION',
      },
      { status: 404 }
    );
  }

  const conv = await ensureConversation(sb, organizationId, conn.id, phone);

  const result = await applyConversationAction(sb, {
    organizationId,
    conversationId: conv.id,
    action: body.action === 'start' ? 'start_bot' : 'cancel_bot',
    botId: body.bot_id,
    context: body.context,
    userId: null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.status === 404 ? 'NOT_FOUND' : 'CONFLICT', conversation_id: conv.id },
      { status: result.status }
    );
  }

  const runAfter = result.runAfter;
  if (runAfter?.kind === 'bot') {
    const { run } = runAfter;
    after(async () => {
      try {
        await runBotRunNow(createStaticAdminClient(), run);
      } catch (err) {
        console.error('[public-api/conversations/bot] falha ao processar o robô', err);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    conversation_id: conv.id,
    phone: conv.wa_phone,
    action: body.action,
    ai: result.ai,
    bot: result.bot,
  });
}
