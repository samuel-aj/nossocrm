/**
 * /api/wa-agents/agents
 *   GET  -> admin: { agents: AgentPublic[] } (sem api_key, com has_api_key; segredos de webhook mascarados)
 *           demais membros: { agents: AgentMinimal[] } (só os ligados; menu do chat)
 *   POST -> (admin) cria um agente a partir de AgentInputSchema -> 201 { agent }
 *           (inclui custom_actions, triggers, helper_agent_ids e tools; gatilho por
 *           pipeline e auxiliares validados na org; segredo mascarado vira vazio)
 */
import { json } from '@/lib/whatsapp/api';
import { checkAgentApiKey } from '@/lib/wa-agents/model';
import { AgentInputSchema, type AgentInput, type AgentMinimal, type AgentRow } from '@/lib/wa-agents/types';
import {
  connectionNotFoundError,
  connectionsBelongToOrg,
  getErrorMessage,
  guardRoute,
  normalizeApiKeyInput,
  readJsonBody,
  restoreMaskedSecrets,
  toAgentPublic,
  uniqueIds,
  validateAgentTriggers,
  validateHelperAgentIds,
  validationError,
} from '../_shared';

export const runtime = 'nodejs';

/** Monta a linha de inserção explicitamente (sem espalhar chaves inesperadas). */
function toInsertRow(input: AgentInput, helperIds: string[]) {
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
    stop_rules: input.stop_rules,
    max_replies: input.max_replies,
    start_mode: input.start_mode,
    followups: input.followups,
    outcomes: input.outcomes,
    webhooks: input.webhooks,
    custom_actions: input.custom_actions,
    triggers: input.triggers,
    helper_agent_ids: helperIds,
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
  // Agente novo não tem segredo salvo: valor mascarado vira vazio
  const input = { ...parsed.data, ...restoreMaskedSecrets(parsed.data, null) } as AgentInput;

  let helperIds: string[] = [];
  try {
    if (!(await connectionsBelongToOrg(auth.admin, orgId, input.connection_ids))) {
      return connectionNotFoundError();
    }
    const triggersError = await validateAgentTriggers(auth.admin, orgId, input.triggers);
    if (triggersError) return triggersError;
    const helpers = await validateHelperAgentIds(auth.admin, orgId, uniqueIds(input.helper_agent_ids));
    if (!helpers.ok) return helpers.response;
    helperIds = helpers.ids;
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar os números') }, 500);
  }

  // Ligar exige chave funcionando (própria ou da org): sem ela o agente é salvo DESLIGADO e avisa
  const row = toInsertRow(input, helperIds);
  let warning: string | null = null;
  if (row.enabled) {
    const check = await checkAgentApiKey(auth.admin, orgId, { provider: input.provider, api_key: row.api_key });
    if (!check.ok) {
      row.enabled = false;
      warning = `${check.error}. O agente foi salvo desligado: configure a chave (Configurações → Integrações ou a chave própria do agente) e ligue de novo.`;
    }
  }

  const { data, error } = await auth.admin
    .from('wa_ai_agents')
    .insert({
      ...row,
      organization_id: orgId,
      created_by: auth.user.id,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ agent: toAgentPublic(data as AgentRow), ...(warning ? { warning } : {}) }, 201);
}
