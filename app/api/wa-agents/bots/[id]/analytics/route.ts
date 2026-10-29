import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { presentBotAnalytics, type RawBotAnalytics } from '@/lib/wa-agents/botAnalytics';
import { guardRoute, validationError } from '../../../_shared';

export const runtime = 'nodejs';
const querySchema = z.object({
  start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }),
  revision: z.string().regex(/^[a-f0-9]{32}$/).optional(), goalStepId: z.string().min(1).max(200).optional(),
}).refine(q => Date.parse(q.start) <= Date.parse(q.end), 'O início deve ser anterior ao fim do período.');

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return validationError(parsed.error);
  const { start, end, revision, goalStepId } = parsed.data;
  const { data, error } = await auth.admin.rpc('wa_bot_analytics', {
    p_org: auth.user.organizationId, p_bot: id, p_start: start, p_end: end,
    p_revision: revision ?? null, p_goal: goalStepId ?? null,
  });
  if (error) {
    if (/Unknown revision|Unknown goal/.test(error.message)) return json({ error: 'Versão ou objetivo não encontrado neste robô.' }, 400);
    console.error('[bot-analytics]', error.code);
    return json({ error: 'Não foi possível consultar as estatísticas do robô.' }, 500);
  }
  if (!data) return json({ error: 'Robô não encontrado' }, 404);
  const response = json(presentBotAnalytics(data as RawBotAnalytics));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
