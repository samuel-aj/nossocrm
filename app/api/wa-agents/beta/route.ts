/**
 * /api/wa-agents/beta
 *   GET  -> { enabled, isAdmin }   estado da chave beta "Agentes de IA e Robôs" da org
 *   POST -> { enabled }            (admin) liga/desliga a chave em ai_feature_flags
 *
 * Desligar devolve o comportamento antigo: as conversas com agente nativo
 * perdem o vínculo (ai_agent_id, pausa temporária, aprovação e trava) e voltam
 * ao estado "nenhum agente atuou"; a API pública e o gatilho de pausa por
 * humano passam a tratá-las como antes da beta.
 *
 * Única rota do módulo que funciona com a beta desligada (é ela que liga).
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { WA_AGENTS_BETA_FLAG } from '@/lib/wa-agents/types';
import { isWaAgentsBetaEnabled } from '@/lib/wa-agents/beta';
import { guardRoute, readJsonBody, validationError } from '../_shared';

export const runtime = 'nodejs';

const BodySchema = z.object({ enabled: z.boolean() });

export async function GET() {
  const auth = await guardRoute({ beta: false });
  if (!auth.ok) return auth.response;

  const enabled = await isWaAgentsBetaEnabled(auth.admin, auth.user.organizationId);
  return json({ enabled, isAdmin: auth.isAdmin });
}

export async function POST(req: Request) {
  const auth = await guardRoute({ req, admin: true, beta: false });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const parsed = BodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);

  const { error } = await auth.admin.from('ai_feature_flags').upsert(
    {
      organization_id: orgId,
      key: WA_AGENTS_BETA_FLAG,
      enabled: parsed.data.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,key' }
  );
  if (error) return json({ error: error.message }, 500);

  let detached = 0;
  if (!parsed.data.enabled) {
    // Conversas com agente nativo voltam ao estado sem agente
    const { data, error: convError } = await auth.admin
      .from('wa_conversations')
      .update({
        ai_agent_id: null,
        ai_status: null,
        ai_status_changed_at: new Date().toISOString(),
        ai_resume_at: null,
        ai_approval: null,
        ai_lock_until: null,
        ai_paused_by: null,
      })
      .eq('organization_id', orgId)
      .not('ai_agent_id', 'is', null)
      .select('id');
    if (convError) return json({ error: `Beta desligada, mas falhou ao desvincular as conversas: ${convError.message}` }, 500);
    detached = (data ?? []).length;
    // Inícios pelo pipeline ainda na fila não rodam mais
    await auth.admin
      .from('wa_ai_agent_deal_starts')
      .update({ status: 'cancelled', processed_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('status', 'pending');
  }

  return json({ enabled: parsed.data.enabled, detached });
}
