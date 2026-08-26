/**
 * /api/wa-agents/bots/[id]  (admin)
 *   GET    -> { bot }  (segredo do passo webhook mascarado)
 *   PATCH  -> BotInputSchema.partial() -> { bot }  (aceita start_step_id e os campos do quadro;
 *             segredo mascarado mantém o valor salvo do passo com o mesmo id)
 *   DELETE -> cancela as execuções abertas e apaga o robô -> { ok: true }
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { BotInputSchema, BotStepSchema, type BotRow, type BotStep } from '@/lib/wa-agents/types';
import {
  connectionNotFoundError,
  connectionsBelongToOrg,
  getErrorMessage,
  guardRoute,
  pickPresentKeys,
  readJsonBody,
  restoreMaskedBotSecrets,
  toBotPublic,
  validateBotSteps,
  validationError,
} from '../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);

  const { data, error } = await auth.admin
    .from('wa_bots')
    .select('*')
    .eq('id', id)
    .eq('organization_id', auth.user.organizationId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Robô não encontrado' }, 404);

  return json({ bot: toBotPublic(data as BotRow) });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);

  const raw = await readJsonBody(req);
  const parsed = BotInputSchema.partial().safeParse(raw);
  if (!parsed.success) return validationError(parsed.error);

  // Só o que veio no corpo (zod v4 aplica defaults mesmo no partial)
  const present = pickPresentKeys(raw, parsed.data);
  const patch: Record<string, unknown> = {
    ...present,
    updated_at: new Date().toISOString(),
  };

  try {
    const connectionId = typeof patch.connection_id === 'string' ? patch.connection_id : null;
    if (connectionId && !(await connectionsBelongToOrg(auth.admin, orgId, [connectionId]))) {
      return connectionNotFoundError();
    }

    // Passos e passo inicial: os enviados ou os já salvos (o que faltar vem do banco).
    // O passo inicial e todo id referenciado precisam existir na lista; segredos
    // mascarados dos passos webhook voltam ao valor salvo (mesmo id).
    const sendsSteps = Array.isArray(present.steps);
    const sendsStart = 'start_step_id' in present;
    if (sendsSteps || sendsStart) {
      const { data: existing, error: existingError } = await auth.admin
        .from('wa_bots')
        .select('steps, start_step_id')
        .eq('id', id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (!existing) return json({ error: 'Robô não encontrado' }, 404);
      const saved = existing as { steps?: unknown[]; start_step_id?: string | null };
      const savedSteps: BotStep[] = [];
      for (const item of (saved.steps ?? []) as unknown[]) {
        const p = BotStepSchema.safeParse(item);
        if (p.success) savedSteps.push(p.data);
      }
      const steps: BotStep[] = sendsSteps ? restoreMaskedBotSecrets(present.steps ?? [], savedSteps) : savedSteps;
      const startStepId: string | null = sendsStart ? (present.start_step_id ?? null) : (saved.start_step_id ?? null);
      const stepsError = validateBotSteps(steps, startStepId);
      if (stepsError) return stepsError;
      if (sendsSteps) patch.steps = steps;
    }
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar o robô') }, 500);
  }

  const { data, error } = await auth.admin
    .from('wa_bots')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Robô não encontrado' }, 404);

  return json({ bot: toBotPublic(data as BotRow) });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const { data: existing, error: findError } = await auth.admin
    .from('wa_bots')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (findError) return json({ error: findError.message }, 500);
  if (!existing) return json({ error: 'Robô não encontrado' }, 404);

  // Execuções em andamento ou esperando resposta são canceladas
  const { error: runsError } = await auth.admin
    .from('wa_bot_runs')
    .update({ status: 'cancelled', lock_until: null, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('bot_id', id)
    .in('status', ['running', 'waiting_reply']);
  if (runsError) return json({ error: runsError.message }, 500);

  const { error } = await auth.admin.from('wa_bots').delete().eq('id', id).eq('organization_id', orgId);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}
