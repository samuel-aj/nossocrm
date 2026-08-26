/**
 * POST /api/wa-agents/conversation  (qualquer membro da org)
 * body { conversationId: uuid,
 *        action: 'pause'|'resume'|'stop'|'start'|'approve'|'reject'|'start_bot'|'cancel_bot',
 *        agentId?: uuid (start), botId?: uuid (start_bot) }
 *
 * Botões do chat: aplica a ação no estado do agente/robô da conversa e, quando
 * a ação pede uma fala do agente (retomar, iniciar, aprovar) ou acabou de criar
 * a execução de um robô (start_bot), roda em segundo plano depois de responder
 * -> { ai: ConversationAiInfo | null, bot: ConversationBotInfo | null }
 */
import { after } from 'next/server';
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { runBotRunNow } from '@/lib/wa-agents/bots';
import { applyConversationAction } from '@/lib/wa-agents/conversation';
import { runAgentOnConversation } from '@/lib/wa-agents/engine';
import { getErrorMessage, guardRoute, readJsonBody, validationError } from '../_shared';

export const runtime = 'nodejs';
/** O agente roda em after() dentro deste teto: geração + auxiliares + envio das linhas */
export const maxDuration = 120;

const BodySchema = z.object({
  conversationId: z.string().uuid(),
  action: z.enum(['pause', 'resume', 'stop', 'start', 'approve', 'reject', 'start_bot', 'cancel_bot']),
  agentId: z.string().uuid().optional(),
  botId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;

  const parsed = BodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const { conversationId, action, agentId, botId } = parsed.data;
  const organizationId = auth.user.organizationId;

  try {
    const result = await applyConversationAction(auth.admin, {
      organizationId,
      conversationId,
      action,
      agentId,
      botId,
      userId: auth.user.id,
    });
    if (!result.ok) return json({ error: result.error }, result.status);

    const runAfter = result.runAfter;
    if (runAfter?.kind === 'agent') {
      const { trigger, agentId: runAgentId, forceReply } = runAfter;
      after(async () => {
        try {
          await runAgentOnConversation({
            organizationId,
            conversationId,
            trigger,
            agentId: runAgentId,
            forceReply,
            skipBuffer: true,
          });
        } catch (err) {
          console.error('[wa-agents/conversation] falha ao rodar o agente', err);
        }
      });
    } else if (runAfter?.kind === 'bot') {
      // Mesmo padrão de /bots/[id]/start: a execução já existe; processa fora da requisição
      const { run } = runAfter;
      after(async () => {
        try {
          await runBotRunNow(createStaticAdminClient(), run);
        } catch (err) {
          console.error('[wa-agents/conversation] falha ao processar o robô', err);
        }
      });
    }

    return json({ ai: result.ai, bot: result.bot });
  } catch (err) {
    console.error('[wa-agents/conversation]', err);
    return json({ error: getErrorMessage(err, 'Falha ao aplicar a ação') }, 500);
  }
}
