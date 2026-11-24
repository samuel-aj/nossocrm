import { after } from 'next/server';
import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { processInboundRecovery } from '@/lib/wa-agents/inboundRecovery';
import { verifyInternalSecret } from '@/lib/wa-agents/internalAuth';
import { json } from '@/lib/whatsapp/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const wakeup = z.union([
  z.object({ job: z.literal('inbound_recovery') }).strict(),
  z.object({
    organization_id: z.string().uuid(), conversation_id: z.string().uuid(), message_id: z.string().uuid(),
  }).strict(),
]);

export async function POST(req: Request) {
  if (!verifyInternalSecret(req)) return json({ error: 'Não autorizado' }, 401);
  const parsed = wakeup.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Dados inválidos' }, 400);
  const message = 'message_id' in parsed.data ? parsed.data : undefined;
  after(async () => {
    try {
      await processInboundRecovery(createStaticAdminClient(), message);
    } catch (error) {
      console.error('[wa-agents] fila de entradas indisponível', message?.message_id, error);
    }
  });
  return json({ accepted: true }, 202);
}
