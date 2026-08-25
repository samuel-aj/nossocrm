/**
 * /api/wa-agents/bots/[id]  (admin)
 *   GET    -> { bot }
 *   PATCH  -> BotInputSchema.partial() -> { bot }  (aceita start_step_id e os campos do quadro)
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
  validateBotStartStep,
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

  return json({ bot: data as BotRow });
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

    // Passo inicial do quadro precisa existir nos passos (os enviados ou os já salvos)
    if (present.start_step_id) {
      let steps: BotStep[] | null = present.steps ?? null;
      if (!steps) {
        const { data: existing, error: existingError } = await auth.admin
          .from('wa_bots')
          .select('steps')
          .eq('id', id)
          .eq('organization_id', orgId)
          .maybeSingle();
        if (existingError) throw new Error(existingError.message);
        if (!existing) return json({ error: 'Robô não encontrado' }, 404);
        steps = [];
        for (const item of ((existing as { steps?: unknown[] }).steps ?? []) as unknown[]) {
          const p = BotStepSchema.safeParse(item);
          if (p.success) steps.push(p.data);
        }
      }
      const startError = validateBotStartStep(steps, present.start_step_id);
      if (startError) return startError;
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

  return json({ bot: data as BotRow });
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
