/**
 * /api/integrations/zapsign/stage-rules/[stageId]  (admin)
 *   GET -> { rule | null, stats }   "ao entrar nesta etapa, manda o contrato X"
 *   PUT -> { rule }                 cria ou altera (ligar vale só para quem entrar daqui em diante)
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { guardRoute, readJsonBody, validationError, getErrorMessage, stageBelongsToOrg } from '@/app/api/wa-agents/_shared';
import { loadZapSignSettings } from '@/lib/zapsign/signatures';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ stageId: string }> };

const Actions = z.object({
  stage_id: z.string().uuid().nullable().optional(),
  tag: z.string().trim().max(60).nullable().optional(),
  bot_id: z.string().uuid().nullable().optional(),
});

const RuleSchema = z
  .object({
    enabled: z.boolean(),
    template_token: z.string().trim().max(200),
    template_name: z.string().trim().max(255).nullable().optional(),
    doc_name: z.string().trim().max(255).nullable().optional(),
    variables: z.record(z.string(), z.string().max(2000)).default({}),
    signer: z
      .object({
        auth_mode: z.enum(['assinaturaTela', 'tokenWhatsapp', 'tokenEmail', 'tokenSms', 'certificadoDigital']).optional(),
        require_cpf: z.boolean().optional(),
        require_selfie_photo: z.boolean().optional(),
        require_document_photo: z.boolean().optional(),
        send: z.enum(['crm_whatsapp', 'zapsign_whatsapp', 'zapsign_email', 'link']).optional(),
        message: z.string().max(1000).optional(),
        allow_refuse: z.boolean().optional(),
      })
      .default({}),
    extra_signers: z
      .array(
        z.object({
          name: z.string().trim().max(120),
          email: z.string().trim().max(200).optional(),
          phone: z.string().trim().max(40).optional(),
          qualification: z.string().trim().max(60).optional(),
        })
      )
      .max(5)
      .default([]),
    on_signed: Actions.default({}),
    on_refused: Actions.default({}),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && !v.template_token) ctx.addIssue({ code: 'custom', path: ['template_token'], message: 'Escolha o modelo' });
  });

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const { stageId } = await ctx.params;
  if (!isValidUUID(stageId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;
  if (!(await stageBelongsToOrg(auth.admin, orgId, stageId))) return json({ error: 'Etapa não encontrada' }, 404);

  const { data, error } = await auth.admin.from('stage_signature_rules').select('*').eq('stage_id', stageId).maybeSingle();
  if (error) {
    if (/stage_signature_rules/.test(error.message)) return json({ rule: null, stats: null, pendingMigration: true });
    return json({ error: error.message }, 500);
  }
  const [{ count: review }, { count: pending }, { count: signed }, settings] = await Promise.all([
    auth.admin.from('deal_signatures').select('id', { count: 'exact', head: true }).eq('stage_id', stageId).eq('origin', 'rule').eq('status', 'review'),
    auth.admin.from('deal_signatures').select('id', { count: 'exact', head: true }).eq('stage_id', stageId).eq('origin', 'rule').in('status', ['queued', 'processing', 'pending']),
    auth.admin.from('deal_signatures').select('id', { count: 'exact', head: true }).eq('stage_id', stageId).eq('origin', 'rule').eq('status', 'signed'),
    loadZapSignSettings(auth.admin, orgId),
  ]);
  return json({ rule: data ?? null, stats: { review: review ?? 0, pending: pending ?? 0, signed: signed ?? 0 }, connected: !!settings });
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
    if (!(await stageBelongsToOrg(auth.admin, orgId, stageId))) return json({ error: 'Etapa não encontrada' }, 404);
    if (input.enabled && !(await loadZapSignSettings(auth.admin, orgId))) {
      return json({ error: 'Conecte a ZapSign em Configurações > Integrações antes de ligar o envio automático.' }, 400);
    }
    for (const [label, a] of [['on_signed', input.on_signed], ['on_refused', input.on_refused]] as const) {
      if (a.stage_id && !(await stageBelongsToOrg(auth.admin, orgId, a.stage_id))) return json({ error: `Etapa de destino inválida (${label})` }, 400);
      if (a.bot_id) {
        const { data: bot } = await auth.admin.from('wa_bots').select('id').eq('id', a.bot_id).eq('organization_id', orgId).maybeSingle();
        if (!bot) return json({ error: 'Robô não encontrado nesta organização' }, 400);
      }
    }
    const row = {
      stage_id: stageId,
      organization_id: orgId,
      enabled: input.enabled,
      template_token: input.template_token,
      template_name: input.template_name ?? null,
      doc_name: input.doc_name ?? null,
      variables: input.variables,
      signer: input.signer,
      extra_signers: input.extra_signers,
      on_signed: input.on_signed,
      on_refused: input.on_refused,
      updated_by: auth.user.id,
    };
    const { data, error } = await auth.admin.from('stage_signature_rules').upsert(row, { onConflict: 'stage_id' }).select('*').single();
    if (error) {
      if (/stage_signature_rules/.test(error.message)) return json({ error: 'A integração com a ZapSign ainda não foi instalada no banco. Fale com o suporte.' }, 503);
      return json({ error: error.message }, 500);
    }
    return json({ rule: data });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao salvar a regra') }, 500);
  }
}
