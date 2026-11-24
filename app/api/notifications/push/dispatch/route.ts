import { after } from 'next/server';
import { verifyInternalSecret } from '@/lib/wa-agents/internalAuth';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { dispatchPendingPush } from '@/lib/notifications/pushDispatch';
import { readWebPushConfig } from '@/lib/notifications/webPush';
import { json } from '@/lib/whatsapp/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!verifyInternalSecret(request)) return json({ error: 'Não autorizado' }, 401);
  const body = await request.json().catch(() => null);
  if (body?.job !== 'web_push') return json({ error: 'Tarefa inválida' }, 400);
  const config = readWebPushConfig();
  if (!config) return json({ error: 'Web Push indisponível nesta instalação.' }, 503);
  after(async () => {
    try {
      await dispatchPendingPush(createStaticAdminClient(), config);
    } catch {
      console.error('[notifications/push] Falha ao processar a fila de notificações.');
    }
  });
  return json({ accepted: true }, 202);
}
