/**
 * /api/wa-agents/bots  (admin)
 *   GET  -> { bots: BotRow[] }
 *   POST -> BotInputSchema -> 201 { bot }
 */
import { json } from '@/lib/whatsapp/api';
import { BotInputSchema, type BotRow } from '@/lib/wa-agents/types';
import { guardRoute, readJsonBody, validationError } from '../_shared';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from('wa_bots')
    .select('*')
    .eq('organization_id', auth.user.organizationId)
    .order('created_at', { ascending: true });
  if (error) return json({ error: error.message }, 500);

  return json({ bots: (data ?? []) as BotRow[] });
}

export async function POST(req: Request) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;

  const parsed = BotInputSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;

  const { data, error } = await auth.admin
    .from('wa_bots')
    .insert({
      name: input.name,
      enabled: input.enabled,
      connection_id: input.connection_id,
      trigger: input.trigger,
      steps: input.steps,
      organization_id: auth.user.organizationId,
      created_by: auth.user.id,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ bot: data as BotRow }, 201);
}
