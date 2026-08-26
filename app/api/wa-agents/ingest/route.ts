/**
 * POST /api/wa-agents/ingest  (interna: chamada pelo banco via pg_net)
 * header X-Internal-Secret; body { organization_id, conversation_id, message_id }
 *
 * Mensagem recebida numa org beta com agente ou robô interessado. Responde
 * 202 na hora e processa em segundo plano (buffer, trava, modelo e envio).
 */
import { after } from 'next/server';
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { verifyInternalSecret } from '@/lib/wa-agents/internalAuth';
import { handleInboundMessage } from '@/lib/wa-agents/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BodySchema = z.object({
  organization_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
});

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) return json({ error: 'Não autorizado' }, 401);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'Dados inválidos', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const { organization_id, conversation_id, message_id } = parsed.data;

  after(async () => {
    try {
      await handleInboundMessage({
        organizationId: organization_id,
        conversationId: conversation_id,
        messageId: message_id,
      });
    } catch (err) {
      console.error('[wa-agents/ingest] falha ao processar mensagem', err);
    }
  });

  return json({ accepted: true }, 202);
}
