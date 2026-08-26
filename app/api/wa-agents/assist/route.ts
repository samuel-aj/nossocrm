/**
 * POST /api/wa-agents/assist  (admin + beta)
 * body { mode: 'generate'|'improve'|'adjust', description?, current_prompt?, instruction?, provider?, model? }
 *
 * IA na configuração do agente: gera o roteiro do zero (generate), reescreve
 * o atual corrigindo lacunas (improve) ou aplica uma instrução (adjust), já
 * nas convenções do CRM -> { persona_name, system_prompt, outcomes, custom_actions }
 *
 * Usa a chave de IA da organização (do provedor informado ou do padrão da org).
 * Sem chave -> 400 { error, code: 'AI_KEY_NOT_CONFIGURED' }.
 */
import { json } from '@/lib/whatsapp/api';
import { assistAgentConfig } from '@/lib/wa-agents/assist';
import { WaAgentError } from '@/lib/wa-agents/errors';
import { AssistInputSchema } from '@/lib/wa-agents/types';
import { getErrorMessage, guardRoute, readJsonBody, validationError } from '../_shared';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;

  const parsed = AssistInputSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);

  try {
    const result = await assistAgentConfig(auth.admin, { organizationId: auth.user.organizationId, ...parsed.data });
    return json(result);
  } catch (err) {
    if (err instanceof WaAgentError) return json({ error: err.message, code: err.code }, 400);
    console.error('[wa-agents/assist]', err);
    return json({ error: getErrorMessage(err, 'Falha ao gerar o roteiro com IA') }, 500);
  }
}
