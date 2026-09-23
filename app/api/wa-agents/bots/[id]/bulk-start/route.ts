import { after } from 'next/server';
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { processDueBotRuns } from '@/lib/wa-agents/bots';
import { MAX_BULK_LEADS, prepareBulkBot, type BulkRunResult } from '@/lib/wa-agents/bulkBots';
import { getErrorMessage, guardRoute, readJsonBody, validationError } from '../../../_shared';

export const runtime = 'nodejs';
export const maxDuration = 300;
const Body = z.object({ dealIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_LEADS), batchId: z.string().uuid(), preview: z.boolean().default(false) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: 'Robô inválido' }, 400);
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { batchId, preview } = parsed.data;
    const prepared = await prepareBulkBot(auth.admin, auth.user.organizationId, id, [...new Set(parsed.data.dealIds)]);
    if (preview) return json(prepared);
    const targets = prepared.recipients.filter(r => r.eligible).map(r => ({ deal_id: r.dealId, contact_id: r.contactId, phone: r.phone }));
    const { data, error } = targets.length ? await auth.admin.rpc('enqueue_bulk_bot_runs', {
      p_org: auth.user.organizationId, p_bot: id, p_batch: batchId, p_targets: targets,
    }) : { data: [], error: null };
    if (error) throw error;
    const results = (data ?? []) as BulkRunResult[];
    after(async () => {
      // Same durable queue and locks as the regular tick; unfinished work remains queued.
      await processDueBotRuns(createStaticAdminClient(), { limit: 10, deadlineMs: Date.now() + 240_000 });
    });
    return json({ ...prepared, batchId, results }, 202);
  } catch (error) {
    return json({ error: getErrorMessage(error, 'Não foi possível preparar o lote.') }, 400);
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const batchId = new URL(req.url).searchParams.get('batchId');
  if (!z.string().uuid().safeParse(batchId).success || !z.string().uuid().safeParse(id).success) return json({ error: 'Lote inválido' }, 400);
  const { data, error } = await auth.admin.from('wa_bot_runs').select('id, deal_id, status, error')
    .eq('organization_id', auth.user.organizationId).eq('bot_id', id).eq('bulk_batch_id', batchId);
  if (error) return json({ error: 'Não foi possível consultar o lote.' }, 500);
  return json({ runs: data ?? [] });
}
