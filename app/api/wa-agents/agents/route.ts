/**
 * /api/wa-agents/agents
 *   GET  -> admin: { agents: AgentPublic[] } (sem api_key, com has_api_key)
 *           demais membros: { agents: AgentMinimal[] } (só os ligados; menu do chat)
 *   POST -> (admin) cria um agente a partir de AgentInputSchema -> 201 { agent }
 *           (inclui custom_actions, triggers, helper_agent_ids e tools; gatilho por
 *           pipeline e auxiliares validados na org)
 */
import { json } from '@/lib/whatsapp/api';
import { AgentInputSchema, type AgentInput, type AgentMinimal, type AgentRow } from '@/lib/wa-agents/types';
import {
  connectionNotFoundError,
  connectionsBelongToOrg,
  getErrorMessage,
  guardRoute,
  normalizeApiKeyInput,
  readJsonBody,
  toAgentPublic,
  uniqueIds,
  validateAgentTriggers,
  validateHelperAgentIds,
  validationError,
} from '../_shared';

export const runtime = 'nodejs';

/** Monta a linha de inserção explicitamente (sem espalhar chaves inesperadas). */
function toInsertRow(input: AgentInput) {
  return {
    name: input.name,
    persona_name: input.persona_name ?? null,
    enabled: input.enabled,
    connection_ids: input.connection_ids,
    provider: input.provider,
    model: input.model,
    temperature: input.temperature,
    api_key: normalizeApiKeyInput(input.api_key) ?? null,
    system_prompt: input.system_prompt,
    buffer_seconds: input.buffer_seconds,
    history_limit: input.history_limit,
    line_delay_ms: input.line_delay_ms,
    human_pause_minutes: input.human_pause_minutes,
    only_new_conversations: input.only_new_conversations,
    outcomes: input.outcomes,
    webhooks: input.webhooks,
    custom_actions: input.custom_actions,
    triggers: input.triggers,
    helper_agent_ids: uniqueIds(input.helper_agent_ids),
    tools: input.tools,
  };
}

export async function GET() {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  if (auth.isAdmin) {
    const { data, error } = await auth.admin
      .from('wa_ai_agents')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ agents: ((data ?? []) as AgentRow[]).map(toAgentPublic) });
  }

  const { data, error } = await auth.admin
    .from('wa_ai_agents')
    .select('id, name, persona_name, enabled')
    .eq('organization_id', orgId)
    .eq('enabled', true)
    .order('name', { ascending: true });
  if (error) return json({ error: error.message }, 500);
  return json({ agents: (data ?? []) as AgentMinimal[] });
}

export async function POST(req: Request) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const parsed = AgentInputSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);

  try {
    if (!(await connectionsBelongToOrg(auth.admin, orgId, parsed.data.connection_ids))) {
      return connectionNotFoundError();
    }
    const triggersError = await validateAgentTriggers(auth.admin, orgId, parsed.data.triggers);
    if (triggersError) return triggersError;
    const helpersError = await validateHelperAgentIds(auth.admin, orgId, parsed.data.helper_agent_ids);
    if (helpersError) return helpersError;
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar os números') }, 500);
  }

  const { data, error } = await auth.admin
    .from('wa_ai_agents')
    .insert({
      ...toInsertRow(parsed.data),
      organization_id: orgId,
      created_by: auth.user.id,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ agent: toAgentPublic(data as AgentRow) }, 201);
}
