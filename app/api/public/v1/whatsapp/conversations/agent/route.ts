/**
 * POST /api/public/v1/whatsapp/conversations/agent -> controla o AGENTE DE IA
 * NATIVO do CRM numa conversa, pelo telefone do contato.
 *
 * É o mesmo que os botões do chat fazem (menu Automações, Pausar, Parar,
 * Limpar memória), só que por integração (n8n/Make). Para o agente EXTERNO
 * (o n8n sendo o cérebro) continue usando /whatsapp/conversations/ai.
 *
 * Body:
 *   { phone: "+5569999999999",
 *     action: "start" | "pause" | "resume" | "stop" | "context" | "reset_memory",
 *     agent_id?: "uuid do agente (obrigatório em start; GET /whatsapp/agents)",
 *     context?: "texto que o agente lê como contexto da equipe (start e context)",
 *     append?: true,          // context: acrescenta em vez de substituir
 *     connection_id?: "por qual número iniciar (GET /whatsapp/connections); omitido = o número
 *                     do gatilho do agente, senão o primeiro número dele, senão o padrão da org" }
 *
 * A conversa é localizada pelo telefone (com as variantes do nono dígito) no
 * número informado; se ainda não existir, é criada.
 *
 * Em "start" o agente já manda a primeira mensagem quando está configurado
 * como "fala primeiro"; a fala roda depois da resposta desta chamada.
 */
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { normalizePhone } from '@/lib/public-api/sanitize';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/supabase/utils';
import { isWaAgentsBetaEnabled } from '@/lib/wa-agents/beta';
import { normalizeTriggers } from '@/lib/wa-agents/context';
import { applyConversationAction } from '@/lib/wa-agents/conversation';
import { runAgentOnConversation } from '@/lib/wa-agents/engine';
import { runBotRunNow } from '@/lib/wa-agents/bots';
import type { ConversationAiAction } from '@/lib/wa-agents/types';
import { ensureConversation, getConnectionByIdForOrg, getConnectionByOrg } from '@/lib/whatsapp/service';

export const runtime = 'nodejs';
/** A fala do agente roda em after() dentro deste teto (geração + envio das linhas) */
export const maxDuration = 120;

const ACTIONS = ['start', 'pause', 'resume', 'stop', 'context', 'reset_memory'] as const;

const BodySchema = z.object({
  phone: z.string().trim().min(5).max(32),
  action: z.enum(ACTIONS),
  agent_id: z.string().trim().optional(),
  context: z.string().trim().max(2000).optional(),
  append: z.boolean().optional(),
  connection_id: z.string().trim().optional(),
});

/** Ação da API pública -> ação interna da conversa. */
const ACTION_MAP: Record<(typeof ACTIONS)[number], ConversationAiAction> = {
  start: 'start',
  pause: 'pause',
  resume: 'resume',
  stop: 'stop',
  context: 'set_context',
  reset_memory: 'reset_memory',
};

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

  if (body.action === 'start' && !body.agent_id) {
    return NextResponse.json({ error: '`agent_id` is required for action "start"', code: 'VALIDATION' }, { status: 400 });
  }
  if (body.agent_id && !isValidUUID(body.agent_id)) {
    return NextResponse.json({ error: 'Invalid `agent_id`', code: 'VALIDATION' }, { status: 400 });
  }
  if (body.action === 'context' && !body.context) {
    return NextResponse.json({ error: '`context` is required for action "context"', code: 'VALIDATION' }, { status: 400 });
  }
  const connectionId = body.connection_id ?? '';
  if (connectionId && !isValidUUID(connectionId)) {
    return NextResponse.json({ error: 'Invalid `connection_id`', code: 'VALIDATION' }, { status: 400 });
  }

  const sb = createStaticAdminClient();
  const organizationId = auth.organizationId;

  if (!(await isWaAgentsBetaEnabled(sb, organizationId))) {
    return NextResponse.json(
      { error: 'Agentes de IA do CRM não estão ligados nesta organização', code: 'AGENTS_OFF' },
      { status: 409 }
    );
  }

  // Número: o informado manda. Sem ele, vale o número do agente — o que o gatilho
  // de pipeline usa para iniciar a conversa e, na falta, o primeiro número em que
  // ele atende. Só então o padrão da organização.
  let alvo = connectionId;
  // Só ao INICIAR: nas outras ações a conversa já existe e mudar o número de
  // busca poderia criar uma conversa nova (integrações antigas continuam iguais).
  if (!alvo && body.action === 'start' && body.agent_id) {
    const { data } = await sb
      .from('wa_ai_agents')
      .select('connection_ids, triggers')
      .eq('organization_id', organizationId)
      .eq('id', body.agent_id)
      .maybeSingle();
    const agente = data as { connection_ids: string[] | null; triggers: unknown } | null;
    if (agente) {
      const doGatilho = normalizeTriggers(agente.triggers).deal.connection_id;
      alvo = doGatilho || agente.connection_ids?.[0] || '';
    }
  }

  const conn = alvo
    ? await getConnectionByIdForOrg(sb, organizationId, alvo)
    : await getConnectionByOrg(sb, organizationId);
  if (!conn) {
    return NextResponse.json(
      {
        error: alvo ? 'Connection not found' : 'No WhatsApp number connected in this organization',
        code: 'NO_CONNECTION',
      },
      { status: 404 }
    );
  }

  const conv = await ensureConversation(sb, organizationId, conn.id, phone);

  const result = await applyConversationAction(sb, {
    organizationId,
    conversationId: conv.id,
    action: ACTION_MAP[body.action],
    agentId: body.agent_id,
    context: body.context,
    appendContext: body.append === true,
    userId: null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.status === 404 ? 'NOT_FOUND' : 'CONFLICT', conversation_id: conv.id },
      { status: result.status }
    );
  }

  // Fala do agente (start/resume) ou execução do robô: depois de responder
  const runAfter = result.runAfter;
  if (runAfter?.kind === 'agent') {
    const { trigger, agentId: runAgentId, forceReply } = runAfter;
    after(async () => {
      try {
        await runAgentOnConversation({
          organizationId,
          conversationId: conv.id,
          trigger,
          agentId: runAgentId,
          forceReply,
          skipBuffer: true,
        });
      } catch (err) {
        console.error('[public-api/conversations/agent] falha ao rodar o agente', err);
      }
    });
  } else if (runAfter?.kind === 'bot') {
    const { run } = runAfter;
    after(async () => {
      try {
        await runBotRunNow(createStaticAdminClient(), run);
      } catch (err) {
        console.error('[public-api/conversations/agent] falha ao processar o robô', err);
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
