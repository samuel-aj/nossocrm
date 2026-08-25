/**
 * /api/wa-agents/tick  (interna: pg_cron a cada 30 s e gatilho de negócio)
 * POST ou GET com header X-Internal-Secret.
 *
 * Relógio do módulo: retoma pausas vencidas (ai_resume_at <= now) e executa os
 * passos de robô que venceram (wake_at <= now). Responde 202 na hora e
 * processa em segundo plano para não estourar o tempo do chamador.
 */
import { after } from 'next/server';
import { json } from '@/lib/whatsapp/api';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { verifyInternalSecret } from '@/lib/wa-agents/internalAuth';
import { resumeDueConversations } from '@/lib/wa-agents/engine';
import { processDueBotRuns } from '@/lib/wa-agents/bots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  if (!verifyInternalSecret(req)) return json({ error: 'Não autorizado' }, 401);

  after(async () => {
    const admin = createStaticAdminClient();
    try {
      await resumeDueConversations(admin, { limit: 50 });
    } catch (err) {
      console.error('[wa-agents/tick] falha ao retomar conversas', err);
    }
    try {
      await processDueBotRuns(admin, { limit: 25 });
    } catch (err) {
      console.error('[wa-agents/tick] falha ao processar robôs', err);
    }
  });

  return json({ accepted: true }, 202);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
