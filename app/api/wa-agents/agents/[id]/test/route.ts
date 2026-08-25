/**
 * POST /api/wa-agents/agents/[id]/test  (admin)
 * body { messages: [{ role: 'user'|'assistant', text }], state? }
 *
 * Gera a resposta do agente em modo de teste: nada é enviado pelo WhatsApp e
 * nenhuma ação de encerramento é executada -> { text, lines, toolCalls, usage }
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { loadAgent } from '@/lib/wa-agents/context';
import { WaAgentError } from '@/lib/wa-agents/errors';
import { testAgentReply } from '@/lib/wa-agents/test';
import { getErrorMessage, guardRoute, readJsonBody, validationError } from '../../../_shared';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(8000) }))
    .max(200)
    .default([]),
  state: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const parsed = BodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);

  // loadAgent normaliza a linha (jsonb validado, números coeridos)
  const agent = await loadAgent(auth.admin, orgId, id);
  if (!agent) return json({ error: 'Agente não encontrado' }, 404);

  try {
    const result = await testAgentReply(auth.admin, {
      organizationId: orgId,
      agent,
      messages: parsed.data.messages,
      state: parsed.data.state,
    });
    return json(result);
  } catch (err) {
    if (err instanceof WaAgentError) return json({ error: err.message, code: err.code }, 400);
    console.error('[wa-agents/test]', err);
    return json({ error: getErrorMessage(err, 'Falha ao testar o agente') }, 500);
  }
}
