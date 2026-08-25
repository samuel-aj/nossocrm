/**
 * POST /api/wa-agents/bots/[id]/start  (admin)
 * body { dealId?: uuid, phone?: string }  (pelo menos um dos dois)
 *
 * Dispara o robô manualmente (teste ou uso avulso). Com dealId, o telefone vem
 * do contato do negócio; com phone, roda só com o número -> { ok, runId }
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { isE164, normalizePhoneE164 } from '@/lib/phone';
import { startBotRun } from '@/lib/wa-agents/bots';
import { getErrorMessage, guardRoute, readJsonBody, validationError } from '../../../_shared';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BodySchema = z.object({
  dealId: z.string().uuid().optional(),
  phone: z.string().trim().max(32).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const parsed = BodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);

  const { data: bot, error: botError } = await auth.admin
    .from('wa_bots')
    .select('id, connection_id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (botError) return json({ error: botError.message }, 500);
  if (!bot) return json({ error: 'Robô não encontrado' }, 404);
  if (!bot.connection_id) {
    return json({ error: 'Escolha o número que envia as mensagens do robô antes de iniciar', code: 'NO_CONNECTION' }, 400);
  }

  const dealId = parsed.data.dealId;
  let phone: string | undefined;
  if (parsed.data.phone) {
    const normalized = normalizePhoneE164(parsed.data.phone);
    if (!isE164(normalized)) {
      return json({ error: 'Telefone inválido. Use o formato +55 com DDD e número', code: 'VALIDATION_ERROR' }, 400);
    }
    phone = normalized;
  }
  if (!dealId && !phone) return json({ error: 'Informe dealId ou phone', code: 'VALIDATION_ERROR' }, 400);

  let contactId: string | undefined;
  if (dealId) {
    const { data: deal, error: dealError } = await auth.admin
      .from('deals')
      .select('id, contact_id')
      .eq('id', dealId)
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (dealError) return json({ error: dealError.message }, 500);
    if (!deal) return json({ error: 'Negócio não encontrado' }, 404);
    contactId = (deal.contact_id as string | null) ?? undefined;
  }

  try {
    const result = await startBotRun(auth.admin, { organizationId: orgId, botId: id, dealId, contactId, phone });
    if (!result.ok) return json({ ok: false, error: result.error ?? 'Falha ao iniciar o robô' }, 400);
    return json({ ok: true, runId: result.runId ?? null });
  } catch (err) {
    console.error('[wa-agents/bots/start]', err);
    return json({ ok: false, error: getErrorMessage(err, 'Falha ao iniciar o robô') }, 500);
  }
}
