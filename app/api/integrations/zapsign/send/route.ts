/**
 * POST /api/integrations/zapsign/send  (membro com permissão de editar o lead)
 *   { deal_id, template_token, template_name?, doc_name?, variables, overrides?, signer, extra_signers?, on_signed?, on_refused?, rule_stage_id? }
 *   -> { signature, outcome }
 * Envio conferido por uma pessoa: cria o documento na ZapSign na hora. Com
 * `rule_stage_id`, aproveita o contrato que o banco preparou ao entrar na
 * etapa (status 'review'); sem ele, é um envio manual.
 *
 * GET /api/integrations/zapsign/send?deal_id=<id>&stage_id=<etapa?>
 *   -> { connected, sandbox, stage_id, rule, existing, review, contact, whatsapp, sources, preview }
 *   o que a tela precisa para montar a conferência: a regra da etapa (a atual
 *   do lead ou a de destino do movimento) como padrão, os valores do lead e o
 *   que já existe desta etapa.
 */
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { createClient } from '@/lib/supabase/server';
import { guardRoute, readJsonBody, validationError, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { createManualSignature, loadLeadSnapshot, loadSignatureRule, loadZapSignSettings, type SignatureRow } from '@/lib/zapsign/signatures';
import { resolveSource, SOURCE_CATALOG } from '@/lib/zapsign/variables';
import { loadCustomFieldDefs } from '@/lib/wa-agents/leadOps';
import { resolveDealConversation } from '@/lib/wa-agents/dealConversation';
import { getConnectionByIdForOrg, type WaConnectionRow } from '@/lib/whatsapp/service';

export const runtime = 'nodejs';

const Body = z.object({
  deal_id: z.string().uuid(),
  template_token: z.string().trim().min(1).max(200),
  template_name: z.string().trim().max(255).nullable().optional(),
  doc_name: z.string().trim().max(255).nullable().optional(),
  variables: z.record(z.string(), z.string().max(2000)).default({}),
  overrides: z.record(z.string(), z.string().max(4000)).optional(),
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
  extra_signers: z.array(z.object({ name: z.string().trim().max(120), email: z.string().trim().max(200).optional(), phone: z.string().trim().max(40).optional(), qualification: z.string().trim().max(60).optional() })).max(5).optional(),
  on_signed: z.object({ stage_id: z.string().uuid().nullable().optional(), tag: z.string().trim().max(60).nullable().optional(), bot_id: z.string().uuid().nullable().optional() }).optional(),
  on_refused: z.object({ stage_id: z.string().uuid().nullable().optional(), tag: z.string().trim().max(60).nullable().optional() }).optional(),
  rule_stage_id: z.string().uuid().nullable().optional(),
});

/** O lead precisa ser visível para este usuário (RLS, inclusive por responsável). */
async function canSeeDeal(dealId: string, orgId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from('deals').select('id').eq('id', dealId).eq('organization_id', orgId).maybeSingle();
  return !!data;
}

type ExistingLite = Pick<SignatureRow, 'id' | 'status' | 'doc_name' | 'template_name' | 'sent_at' | 'signed_at' | 'created_at'>;

export async function GET(req: Request) {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;
  const url = new URL(req.url);
  const dealId = (url.searchParams.get('deal_id') || '').trim();
  const wantedStage = (url.searchParams.get('stage_id') || '').trim();
  if (!isValidUUID(dealId)) return json({ error: 'ID inválido' }, 400);
  if (wantedStage && !isValidUUID(wantedStage)) return json({ error: 'Etapa inválida' }, 400);
  if (!(await canSeeDeal(dealId, orgId))) return json({ error: 'Lead não encontrado' }, 404);
  try {
    const [settings, snap, defs] = await Promise.all([loadZapSignSettings(auth.admin, orgId), loadLeadSnapshot(auth.admin, orgId, dealId), loadCustomFieldDefs(auth.admin, orgId).catch(() => [])]);
    if (!snap) return json({ error: 'Lead não encontrado' }, 404);
    const stageId = wantedStage || snap.deal.stage_id || null;
    const [rule, rows, whatsapp] = await Promise.all([
      stageId ? loadSignatureRule(auth.admin, orgId, stageId) : Promise.resolve(null),
      stageId
        ? auth.admin
            .from('deal_signatures')
            .select('id, status, doc_name, template_name, sent_at, signed_at, created_at')
            .eq('organization_id', orgId)
            .eq('deal_id', dealId)
            .eq('stage_id', stageId)
            .neq('status', 'cancelled')
            .order('created_at', { ascending: false })
            .limit(5)
            .then((r) => (r.data ?? []) as ExistingLite[])
        : Promise.resolve([] as ExistingLite[]),
      whatsappReadiness(auth.admin, orgId, snap.deal),
    ]);
    const sources = [
      ...SOURCE_CATALOG,
      ...defs.map((f) => ({ value: `campo:${f.key}`, label: f.label, group: 'Campos personalizados' })),
    ];
    const preview: Record<string, string> = {};
    for (const s of sources) preview[s.value] = resolveSource(s.value, snap.ctx);
    const review = rows.find((r) => r.status === 'review') ?? null;
    const existing = rows.find((r) => r.status !== 'review') ?? null;
    return json({
      connected: !!settings,
      sandbox: settings?.sandbox ?? false,
      stage_id: stageId,
      rule,
      // contrato desta etapa já preparado e aguardando conferência
      review: review ? { id: review.id, created_at: review.created_at } : null,
      // contrato desta etapa já enviado (ou assinado) antes
      existing,
      contact: { name: snap.contact.name, email: snap.contact.email, phone: snap.contact.phone },
      whatsapp,
      sources,
      preview,
    });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao preparar o envio') }, 500);
  }
}

/** O link pelo WhatsApp do CRM tem por onde sair? (conversa ligada e número conectado) */
async function whatsappReadiness(admin: SupabaseClient, orgId: string, deal: { id: string; contact_id: string | null }): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const resolved = await resolveDealConversation(admin, orgId, { id: deal.id, contact_id: deal.contact_id });
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    if (!resolved.conversation) return { ok: false, reason: 'o lead não tem conversa no WhatsApp' };
    if (!resolved.conversation.connection_id) return { ok: false, reason: 'a conversa não tem número conectado' };
    const connection = (await getConnectionByIdForOrg(admin, orgId, resolved.conversation.connection_id)) as WaConnectionRow | null;
    if (!connection) return { ok: false, reason: 'o número da conversa não existe mais' };
    if (connection.status !== 'connected') return { ok: false, reason: 'o número da conversa está desconectado' };
    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: getErrorMessage(err, 'não foi possível verificar a conversa') };
  }
}

export async function POST(req: Request) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;
  if (!(await canSeeDeal(input.deal_id, orgId))) return json({ error: 'Lead não encontrado' }, 404);
  try {
    if (!(await loadZapSignSettings(auth.admin, orgId))) return json({ error: 'A ZapSign não está conectada nesta organização.' }, 409);
    const { row, outcome } = await createManualSignature(auth.admin, {
      organizationId: orgId,
      dealId: input.deal_id,
      userId: auth.user.id,
      ruleStageId: input.rule_stage_id ?? null,
      request: {
        template_token: input.template_token,
        template_name: input.template_name ?? null,
        doc_name: input.doc_name ?? null,
        variables: input.variables,
        overrides: input.overrides,
        signer: input.signer,
        extra_signers: input.extra_signers ?? [],
        on_signed: input.on_signed ?? {},
        on_refused: input.on_refused ?? {},
      },
    });
    const status = outcome.status === 'pending' ? 200 : outcome.status === 'failed' ? 502 : 409;
    return json({ signature: row, outcome }, status);
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao enviar para assinatura') }, 500);
  }
}
