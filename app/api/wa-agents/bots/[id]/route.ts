import { botTemplateConnectionError } from '@/lib/wa-agents/templateConnections';
/**
 * /api/wa-agents/bots/[id]  (admin)
 *   GET    -> { bot }  (segredo do passo webhook mascarado)
 *   PATCH  -> BotInputSchema.partial() -> { bot }  (aceita start_step_id, layout (balões) e os campos
 *             do quadro; segredo mascarado mantém o valor salvo do passo com o mesmo id; ligar o
 *             robô exige um começo: robô vazio ou com o gatilho solto só fica salvo desligado)
 *   DELETE -> cancela as execuções abertas e apaga o robô -> { ok: true }
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { BotInputSchema, BotStepSchema, normalizeBotLayout, type BotRow, type BotStep } from '@/lib/wa-agents/types';
import {
  connectionNotFoundError,
  connectionsBelongToOrg,
  dropDeletedConnections,
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
    if (Array.isArray(patch.connection_ids)) {
      patch.connection_ids = await dropDeletedConnections(auth.admin, patch.connection_ids as string[]);
    } else if ('connection_id' in present) {
      patch.connection_ids = typeof patch.connection_id === 'string' ? [patch.connection_id] : [];
    }
    const numeros = Array.isArray(patch.connection_ids)
      ? (patch.connection_ids as string[])
      : typeof patch.connection_id === 'string' && patch.connection_id
        ? [patch.connection_id]
        : [];
    if (numeros.length > 0 && !(await connectionsBelongToOrg(auth.admin, orgId, numeros))) {
      return connectionNotFoundError();
    }
    // A coluna antiga acompanha o primeiro da lista (quem ainda lê connection_id não quebra)
    if (Array.isArray(patch.connection_ids)) patch.connection_id = (patch.connection_ids as string[])[0] ?? null;

    // Passos, passo inicial, balões e ligado/desligado: os enviados ou os já salvos
    // (o que faltar vem do banco). O passo inicial e todo id referenciado precisam
    // existir na lista, os balões precisam bater com os passos e ligar o robô exige
    // um começo; segredos mascarados dos passos webhook voltam ao valor salvo (mesmo id).
    const sendsSteps = Array.isArray(present.steps);
    const sendsStart = 'start_step_id' in present;
    const sendsLayout = 'layout' in present;
    const sendsEnabled = typeof present.enabled === 'boolean';
    if (sendsSteps || sendsStart || sendsLayout || sendsEnabled || 'connection_ids' in present || 'connection_id' in present || 'trigger' in present) {
      const { data: existing, error: existingError } = await auth.admin
        .from('wa_bots')
        .select('steps, start_step_id, layout, enabled, connection_ids, connection_id, trigger')
        .eq('id', id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (!existing) return json({ error: 'Robô não encontrado' }, 404);
      const saved = existing as {
        steps?: unknown[];
        start_step_id?: string | null;
        layout?: unknown;
        enabled?: boolean;
        connection_ids?: string[] | null;
        connection_id?: string | null;
        trigger?: { type?: string; board_id?: string | null; stage_id?: string | null } | null;
      };
      const savedSteps: BotStep[] = [];
      for (const item of (saved.steps ?? []) as unknown[]) {
        const p = BotStepSchema.safeParse(item);
        if (p.success) savedSteps.push(p.data);
      }
      const steps: BotStep[] = sendsSteps ? restoreMaskedBotSecrets(present.steps ?? [], savedSteps) : savedSteps;
      const startStepId: string | null = sendsStart ? (present.start_step_id ?? null) : (saved.start_step_id ?? null);
      const layout = sendsLayout && present.layout ? present.layout : normalizeBotLayout(saved.layout);
      const enabled = sendsEnabled ? present.enabled === true : saved.enabled === true;
      const stepsError = validateBotSteps(steps, startStepId, layout, enabled);
      if (stepsError) return stepsError;
      // Ligar (inclusive pelo botão da lista, que só manda "enabled") confere o mesmo
      // que o editor: número escolhido, gatilho completo e nenhum bloco inválido salvo
      if (enabled) {
        const numerosFinais = Array.isArray(patch.connection_ids)
          ? (patch.connection_ids as string[])
          : (saved.connection_ids ?? []).length > 0
            ? (saved.connection_ids as string[])
            : saved.connection_id
              ? [saved.connection_id]
              : [];
        if (numerosFinais.length === 0) {
          return json({ error: 'Escolha em quais números o robô atende antes de ligá-lo' }, 400);
        }
        const templateError = await botTemplateConnectionError(auth.admin, orgId, steps, numerosFinais);
        if (templateError) return json({ error: templateError }, 400);
        const trigger = (present.trigger ?? saved.trigger) as { type?: string; stage_id?: string | null } | null;
        if (trigger?.type === 'deal_stage_entered' && !trigger.stage_id) {
          return json({ error: 'O gatilho "Entrou na etapa" está sem etapa: abra o robô e escolha a etapa antes de ligar' }, 400);
        }
        if (!sendsSteps && (saved.steps ?? []).length > savedSteps.length) {
          return json({ error: 'O robô tem blocos incompletos ou inválidos: abra o editor, corrija e salve antes de ligar' }, 400);
        }
      }
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
