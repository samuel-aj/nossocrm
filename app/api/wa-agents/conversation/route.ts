/**
 * POST /api/wa-agents/conversation  (qualquer membro da org)
 * body { conversationId: uuid, action: 'pause'|'resume'|'stop'|'start'|'approve'|'reject', agentId?: uuid }
 *
 * Botões do chat: aplica a ação no estado do agente da conversa e, quando a
 * ação pede uma fala do agente (retomar, iniciar, aprovar), roda o agente em
 * segundo plano depois de responder -> { ai: ConversationAiInfo | null }
 */
import { after } from 'next/server';
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { applyConversationAction } from '@/lib/wa-agents/conversation';
import { runAgentOnConversation } from '@/lib/wa-agents/engine';
import { getErrorMessage, guardRoute, readJsonBody, validationError } from '../_shared';

export const runtime = 'nodejs';
/** O agente roda em after() dentro deste teto: geração + auxiliares + envio das linhas */
export const maxDuration = 120;

const BodySchema = z.object({
  conversationId: z.string().uuid(),
  action: z.enum(['pause', 'resume', 'stop', 'start', 'approve', 'reject']),
  agentId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;

  const parsed = BodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const { conversationId, action, agentId } = parsed.data;
  const organizationId = auth.user.organizationId;

  try {
    const result = await applyConversationAction(auth.admin, {
      organizationId,
      conversationId,
      action,
      agentId,
      userId: auth.user.id,
    });
    if (!result.ok) return json({ error: result.error }, result.status);

    if (result.runAfter) {
      const { trigger, agentId: runAgentId, forceReply } = result.runAfter;
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
    }

    return json({ ai: result.ai });
  } catch (err) {
    console.error('[wa-agents/conversation]', err);
    return json({ error: getErrorMessage(err, 'Falha ao aplicar a ação') }, 500);
  }
}
