/**
 * POST /api/integrations/zapsign/ai-fill   (membro que vê o lead)
 *   { deal_id, template_name?, variables: [{ name, current, source }] }
 *   -> { fields: [{ name, value, origin, evidence, changed }], used, notes, model }
 *
 * A IA da organização lê o lead, a conversa do WhatsApp, as ligações
 * (transcritas) e as notas internas e sugere o valor de cada variável do
 * modelo. Não cria nem envia documento: a tela aplica as sugestões e a pessoa
 * confere antes de enviar.
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { createClient } from '@/lib/supabase/server';
import { guardRoute, readJsonBody, validationError, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { isAIFeatureEnabled } from '@/lib/ai/features/server';
import { loadZapSignSettings } from '@/lib/zapsign/signatures';
import { AiFillError, runContractAiFill } from '@/lib/zapsign/aiFill';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  deal_id: z.string().uuid(),
  template_name: z.string().trim().max(255).nullable().optional(),
  variables: z
    .array(z.object({ name: z.string().trim().min(1).max(120), current: z.string().max(4000).default(''), source: z.string().max(200).default('') }))
    .max(120),
});

export async function POST(req: Request) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;

  // O lead precisa ser visível para este usuário (RLS, inclusive por responsável)
  const supabase = await createClient();
  const { data: visible } = await supabase.from('deals').select('id').eq('id', input.deal_id).eq('organization_id', orgId).maybeSingle();
  if (!visible) return json({ error: 'Lead não encontrado' }, 404);

  try {
    if (!(await loadZapSignSettings(auth.admin, orgId))) return json({ error: 'A ZapSign não está conectada nesta organização.' }, 409);
    if (!(await isAIFeatureEnabled(auth.admin, orgId, 'ai_contract_fill'))) {
      return json({ error: 'A IA para preencher contratos está desligada nesta organização.', code: 'AI_FEATURE_DISABLED' }, 403);
    }
    const result = await runContractAiFill(auth.admin, orgId, {
      dealId: input.deal_id,
      templateName: input.template_name ?? '',
      variables: input.variables,
    });
    return json(result);
  } catch (err) {
    if (err instanceof AiFillError) return json({ error: err.message, code: err.code }, err.status);
    console.error('[zapsign/ai-fill] falha', err);
    return json({ error: getErrorMessage(err, 'A IA não conseguiu preencher agora. Tente de novo.') }, 502);
  }
}
