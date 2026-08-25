/**
 * /api/wa-agents/agents/[id]  (admin)
 *   GET    -> { agent }      AgentPublic (sem api_key)
 *   PATCH  -> { agent }      AgentInputSchema.partial(); api_key: ausente mantém,
 *                            '' ou null limpa, valor mascarado (quatro pontos) ignora
 *   DELETE -> { ok: true }   desvincula as conversas em andamento e apaga o agente
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { AgentInputSchema, type AgentRow } from '@/lib/wa-agents/types';
import {
  connectionNotFoundError,
  connectionsBelongToOrg,
  getErrorMessage,
  guardRoute,
  normalizeApiKeyInput,
  pickPresentKeys,
  readJsonBody,
  toAgentPublic,
  validationError,
} from '../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

async function fetchAgent(admin: SupabaseClient, orgId: string, id: string): Promise<AgentRow | null> {
  const { data, error } = await admin
    .from('wa_ai_agents')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AgentRow | null) ?? null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);

  try {
    const agent = await fetchAgent(auth.admin, auth.user.organizationId, id);
    if (!agent) return json({ error: 'Agente não encontrado' }, 404);
    return json({ agent: toAgentPublic(agent) });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao carregar o agente') }, 500);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);

  const raw = await readJsonBody(req);
  const parsed = AgentInputSchema.partial().safeParse(raw);
  if (!parsed.success) return validationError(parsed.error);

  // Só o que veio no corpo (zod v4 aplica defaults mesmo no partial)
  const present = pickPresentKeys(raw, parsed.data);
  const { api_key: apiKeyInput, ...fields } = present;
  const patch: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
  if ('persona_name' in present) patch.persona_name = fields.persona_name ?? null;
  if ('api_key' in present) {
    const apiKey = normalizeApiKeyInput(apiKeyInput);
    if (apiKey !== undefined) patch.api_key = apiKey;
  }

  try {
    if (
      Array.isArray(present.connection_ids) &&
      !(await connectionsBelongToOrg(auth.admin, auth.user.organizationId, present.connection_ids))
    ) {
      return connectionNotFoundError();
    }
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar os números') }, 500);
  }

  const { data, error } = await auth.admin
    .from('wa_ai_agents')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', auth.user.organizationId)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Agente não encontrado' }, 404);

  return json({ agent: toAgentPublic(data as AgentRow) });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const { data: existing, error: findError } = await auth.admin
    .from('wa_ai_agents')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (findError) return json({ error: findError.message }, 500);
  if (!existing) return json({ error: 'Agente não encontrado' }, 404);

  // Conversas em andamento com este agente param (o atendente assume)
  const { error: convError } = await auth.admin
    .from('wa_conversations')
    .update({
      ai_agent_id: null,
      ai_status: 'stopped',
      ai_status_changed_at: new Date().toISOString(),
      ai_resume_at: null,
      ai_approval: null,
    })
    .eq('organization_id', orgId)
    .eq('ai_agent_id', id)
    .in('ai_status', ['active', 'paused', 'awaiting_approval']);
  if (convError) return json({ error: convError.message }, 500);

  const { error } = await auth.admin.from('wa_ai_agents').delete().eq('id', id).eq('organization_id', orgId);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
}
