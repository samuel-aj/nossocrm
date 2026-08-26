/**
 * GET /api/wa-agents/bot-runs  (admin)
 * query: botId?, limit? (<= 100, padrão 50)
 * -> { runs: BotRunRow[], bots: Record<id, name> }
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import type { BotRunRow } from '@/lib/wa-agents/types';
import { guardRoute, searchParamsToObject, validationError } from '../_shared';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  botId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(req: Request) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const parsed = QuerySchema.safeParse(searchParamsToObject(req));
  if (!parsed.success) return validationError(parsed.error);
  const { botId, limit } = parsed.data;

  let query = auth.admin
    .from('wa_bot_runs')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (botId) query = query.eq('bot_id', botId);

  const [runsRes, botsRes] = await Promise.all([
    query,
    auth.admin.from('wa_bots').select('id, name').eq('organization_id', orgId),
  ]);
  if (runsRes.error) return json({ error: runsRes.error.message }, 500);
  if (botsRes.error) return json({ error: botsRes.error.message }, 500);

  const bots: Record<string, string> = {};
  for (const b of botsRes.data ?? []) bots[String(b.id)] = String(b.name ?? '');

  return json({ runs: (runsRes.data ?? []) as BotRunRow[], bots });
}
