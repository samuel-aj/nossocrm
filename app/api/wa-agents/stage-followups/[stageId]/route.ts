/**
 * /api/wa-agents/stage-followups/[stageId]  (admin)
 *   GET -> { rule | null, stats }  regra de follow-up por inatividade da etapa
 *   PUT -> { rule }                cria ou altera (o banco recalcula os agendamentos)
 *
 * Validação: a etapa, o robô e o modelo precisam ser da organização; tempo de
 * 1 minuto a 30 dias. Desligar ou editar invalida os agendamentos antigos (gatilho
 * no banco).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { getErrorMessage, guardRoute, readJsonBody, validationError } from '../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ stageId: string }> };

const RuleSchema = z
  .object({
    enabled: z.boolean(),
    delay_seconds: z.number().int().min(60).max(2592000),
    action_type: z.enum(['bot', 'message']),
    bot_id: z.string().uuid().nullable().optional(),
    message: z
      .object({
        kind: z.enum(['text', 'template']),
        text: z.string().max(4000).optional(),
        template_id: z.string().uuid().optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.enabled) return;
    if (v.action_type === 'bot' && !v.bot_id) ctx.addIssue({ code: 'custom', path: ['bot_id'], message: 'Escolha o robô' });
    if (v.action_type === 'message') {
      if (!v.message) ctx.addIssue({ code: 'custom', path: ['message'], message: 'Configure a mensagem' });
      else if (v.message.kind === 'text' && !v.message.text?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['message', 'text'], message: 'Escreva a mensagem' });
      } else if (v.message.kind === 'template' && !v.message.template_id) {
        ctx.addIssue({ code: 'custom', path: ['message', 'template_id'], message: 'Escolha o modelo' });
      }
    }
  });

async function loadStage(admin: SupabaseClient, orgId: string, stageId: string) {
  const { data } = await admin.from('board_stages').select('id, board_id, organization_id').eq('id', stageId).maybeSingle();
  const stage = data as { id: string; board_id: string; organization_id: string } | null;
  return stage && stage.organization_id === orgId ? stage : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const { stageId } = await ctx.params;
  if (!isValidUUID(stageId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;
  if (!(await loadStage(auth.admin, orgId, stageId))) return json({ error: 'Etapa não encontrada' }, 404);

  const { data, error } = await auth.admin.from('stage_followup_rules').select('*').eq('stage_id', stageId).maybeSingle();
  if (error) {
    if (/stage_followup_rules/.test(error.message)) return json({ rule: null, stats: null, pendingMigration: true });
    return json({ error: error.message }, 500);
  }
  const { data: sched } = await auth.admin
    .from('deal_followup_schedules')
    .select('status, due_at')
    .eq('stage_id', stageId)
    .in('status', ['scheduled', 'processing']);
  const list = (sched ?? []) as Array<{ status: string; due_at: string }>;
  const next = list.map((s) => s.due_at).sort()[0] ?? null;
  return json({ rule: data ?? null, stats: { pending: list.length, next_due_at: next } });
}

export async function PUT(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const { stageId } = await ctx.params;
  if (!isValidUUID(stageId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const parsed = RuleSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;

  try {
    if (!(await loadStage(auth.admin, orgId, stageId))) return json({ error: 'Etapa não encontrada' }, 404);
    if (input.action_type === 'bot' && input.bot_id) {
      const { data: bot } = await auth.admin.from('wa_bots').select('id').eq('id', input.bot_id).eq('organization_id', orgId).maybeSingle();
      if (!bot) return json({ error: 'Robô não encontrado nesta organização' }, 400);
    }
    if (input.action_type === 'message' && input.message?.kind === 'template' && input.message.template_id) {
      const { data: tpl } = await auth.admin
        .from('message_templates')
        .select('id')
        .eq('id', input.message.template_id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!tpl) return json({ error: 'Modelo não encontrado nesta organização' }, 400);
    }

    const row = {
      stage_id: stageId,
      organization_id: orgId,
      enabled: input.enabled,
      delay_seconds: input.delay_seconds,
      action_type: input.action_type,
      bot_id: input.action_type === 'bot' ? input.bot_id ?? null : null,
      message:
        input.action_type === 'message' && input.message
          ? input.message.kind === 'template'
            ? { kind: 'template', template_id: input.message.template_id }
            : { kind: 'text', text: (input.message.text ?? '').trim() }
          : {},
      updated_by: auth.user.id,
    };
    const { data, error } = await auth.admin.from('stage_followup_rules').upsert(row, { onConflict: 'stage_id' }).select('*').single();
    if (error) {
      if (/stage_followup_rules/.test(error.message)) {
        return json({ error: 'O follow-up por inatividade ainda não foi instalado no banco. Fale com o suporte.' }, 503);
      }
      return json({ error: error.message }, 500);
    }
    return json({ rule: data });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao salvar o follow-up') }, 500);
  }
}
