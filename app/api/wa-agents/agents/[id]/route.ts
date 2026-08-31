/**
 * /api/wa-agents/agents/[id]  (admin)
 *   GET    -> { agent }      AgentPublic (sem api_key; segredos de webhook mascarados)
 *   PATCH  -> { agent }      AgentInputSchema.partial(); api_key: ausente mantém,
 *                            '' ou null limpa, valor mascarado (quatro pontos) ignora;
 *                            segredos de webhook mascarados mantêm o valor salvo;
 *                            custom_actions e triggers aceitos (gatilho por pipeline validado;
 *                            triggers parcial é mesclado por bloco com o salvo);
 *                            helper_agent_ids (da org, ligados, diferentes do próprio; ids de
 *                            agentes excluídos são descartados) e tools
 *   DELETE -> { ok: true }   desvincula as conversas em andamento, tira o agente da lista de
 *                            auxiliares dos outros, apaga o agente (documentos, trechos e
 *                            mídias em cascata) e os arquivos do bucket
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { normalizeTriggers } from '@/lib/wa-agents/context';
import { checkAgentApiKey } from '@/lib/wa-agents/model';
import { AgentInputSchema, type AgentRow, type AgentTriggers } from '@/lib/wa-agents/types';
import {
  connectionNotFoundError,
  connectionsBelongToOrg,
  getErrorMessage,
  guardRoute,
  normalizeApiKeyInput,
  pickPresentKeys,
  readJsonBody,
  removeAgentFiles,
  removeHelperReferences,
  restoreMaskedSecrets,
  toAgentPublic,
  uniqueIds,
  validateAgentTriggers,
  validateHelperAgentIds,
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

/**
 * PATCH parcial de triggers: mescla cada bloco (inbound/deal) com o que está salvo.
 * Sem isso os defaults do zod substituiriam o objeto inteiro. Valores que não
 * são objeto seguem como vieram (o zod rejeita).
 */
function mergeTriggers(current: AgentTriggers, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
  const inc = incoming as Record<string, unknown>;
  const block = (key: 'inbound' | 'deal') => {
    const value = inc[key];
    if (value === undefined) return current[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return { ...current[key], ...(value as Record<string, unknown>) };
  };
  return { ...inc, inbound: block('inbound'), deal: block('deal') };
}

/** Campos do corpo que precisam do agente salvo para serem mesclados (triggers) ou restaurados (segredos). */
const NEEDS_EXISTING = ['triggers', 'webhooks', 'outcomes', 'custom_actions'];

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
  const orgId = auth.user.organizationId;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);

  const raw = await readJsonBody(req);
  let body = raw;
  let existing: AgentRow | null = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && NEEDS_EXISTING.some(k => k in raw)) {
    try {
      existing = await fetchAgent(auth.admin, orgId, id);
      if (!existing) return json({ error: 'Agente não encontrado' }, 404);
      if ('triggers' in raw) {
        const incoming = (raw as { triggers?: unknown }).triggers;
        body = { ...raw, triggers: mergeTriggers(normalizeTriggers(existing.triggers), incoming) };
      }
    } catch (err) {
      return json({ error: getErrorMessage(err, 'Falha ao carregar o agente') }, 500);
    }
  }
  const parsed = AgentInputSchema.partial().safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  // Só o que veio no corpo (zod v4 aplica defaults mesmo no partial); segredos mascarados voltam ao salvo
  const present = restoreMaskedSecrets(pickPresentKeys(body, parsed.data), existing);
  const { api_key: apiKeyInput, audio_api_key: audioKeyInput, ...fields } = present;
  const patch: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
  if ('persona_name' in present) patch.persona_name = fields.persona_name ?? null;
  if ('api_key' in present) {
    const apiKey = normalizeApiKeyInput(apiKeyInput);
    if (apiKey !== undefined) patch.api_key = apiKey;
  }
  if ('audio_api_key' in present) {
    const audioKey = normalizeApiKeyInput(audioKeyInput);
    if (audioKey !== undefined) patch.audio_api_key = audioKey;
  }

  try {
    if (
      Array.isArray(present.connection_ids) &&
      !(await connectionsBelongToOrg(auth.admin, orgId, present.connection_ids))
    ) {
      return connectionNotFoundError();
    }
    if (present.triggers) {
      const triggersError = await validateAgentTriggers(auth.admin, orgId, present.triggers);
      if (triggersError) return triggersError;
    }
    if (Array.isArray(present.helper_agent_ids)) {
      const helpers = await validateHelperAgentIds(auth.admin, orgId, uniqueIds(present.helper_agent_ids), id);
      if (!helpers.ok) return helpers.response;
      patch.helper_agent_ids = helpers.ids;
    }
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar os números') }, 500);
  }

  // Ligar exige chave funcionando (própria ou da org): senão o agente fica desligado e avisa
  let warning: string | null = null;
  if (patch.enabled === true) {
    const current = existing ?? (await fetchAgent(auth.admin, orgId, id));
    if (!current) return json({ error: 'Agente não encontrado' }, 404);
    const provider = typeof patch.provider === 'string' ? (patch.provider as AgentRow['provider']) : current.provider;
    const apiKey = 'api_key' in patch ? ((patch.api_key as string | null) ?? null) : (current.api_key ?? null);
    const check = await checkAgentApiKey(auth.admin, orgId, { provider, api_key: apiKey });
    if (!check.ok) {
      patch.enabled = false;
      warning = `${check.error}. O agente ficou desligado: configure a chave (Configurações → Integrações ou a chave própria do agente) e ligue de novo.`;
    }
  }

  const { data, error } = await auth.admin
    .from('wa_ai_agents')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Agente não encontrado' }, 404);

  return json({ agent: toAgentPublic(data as AgentRow), ...(warning ? { warning } : {}) });
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

  // Outros agentes que o tinham como auxiliar (helper_agent_ids não tem chave estrangeira)
  try {
    await removeHelperReferences(auth.admin, orgId, id);
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao atualizar os agentes auxiliares') }, 500);
  }

  // Arquivos do bucket (as linhas de documentos, trechos e mídias caem em cascata)
  const [{ data: docs }, { data: media }] = await Promise.all([
    auth.admin.from('wa_ai_agent_documents').select('storage_path').eq('organization_id', orgId).eq('agent_id', id),
    auth.admin.from('wa_ai_agent_media').select('storage_path').eq('organization_id', orgId).eq('agent_id', id),
  ]);
  const paths = [...((docs ?? []) as Array<{ storage_path: string }>), ...((media ?? []) as Array<{ storage_path: string }>)]
    .map(r => r.storage_path)
    .filter(p => typeof p === 'string' && p.startsWith(`${orgId}/`));

  const { error } = await auth.admin.from('wa_ai_agents').delete().eq('id', id).eq('organization_id', orgId);
  if (error) return json({ error: error.message }, 500);

  await removeAgentFiles(auth.admin, paths);

  return json({ ok: true });
}
