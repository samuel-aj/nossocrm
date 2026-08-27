/**
 * Resolve o modelo de IA de um agente: chave própria ou a chave da organização.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LanguageModel } from 'ai';
import { getModel } from '@/lib/ai/config';
import { PROVIDER_LABELS } from './catalog';
import { WaAgentError } from './errors';
import type { AgentProvider, AgentRow } from './types';

const ORG_KEY_COLUMN: Record<AgentProvider, 'ai_openai_key' | 'ai_anthropic_key' | 'ai_google_key'> = {
  openai: 'ai_openai_key',
  anthropic: 'ai_anthropic_key',
  google: 'ai_google_key',
};

/** Chave da organização para o provedor (organization_settings). '' se não houver. */
export async function getOrganizationApiKey(
  admin: SupabaseClient,
  organizationId: string,
  provider: AgentProvider
): Promise<string> {
  const column = ORG_KEY_COLUMN[provider];
  const { data } = await admin
    .from('organization_settings')
    .select('ai_openai_key, ai_anthropic_key, ai_google_key')
    .eq('organization_id', organizationId)
    .maybeSingle();
  const row = (data ?? {}) as Record<string, string | null>;
  return (row[column] ?? '').trim();
}

/** Modelos de raciocínio da OpenAI (gpt-5*, o1/o3/o4) recusam temperature diferente do padrão. */
export function supportsTemperature(agent: Pick<AgentRow, 'provider' | 'model'>): boolean {
  if (agent.provider !== 'openai') return true;
  return !/^(gpt-5|o\d)/i.test((agent.model || '').trim());
}

/**
 * Confere se a chave funciona no provedor (chamada barata: listar modelos). Só 401/403
 * (e 400 do Google com chave inválida) contam como chave ruim; erro de rede ou outro
 * status não bloqueia (não é problema da chave).
 */
export async function checkProviderApiKey(
  provider: AgentProvider,
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  const key = (apiKey ?? '').trim();
  if (!key) return { ok: false, error: `Chave da API não configurada para ${PROVIDER_LABELS[provider]}` };
  const url =
    provider === 'openai'
      ? 'https://api.openai.com/v1/models?limit=1'
      : provider === 'anthropic'
        ? 'https://api.anthropic.com/v1/models?limit=1'
        : `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`;
  const headers: Record<string, string> =
    provider === 'openai'
      ? { Authorization: `Bearer ${key}` }
      : provider === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : {};
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403 || (provider === 'google' && res.status === 400)) {
      return { ok: false, error: `Chave da API de ${PROVIDER_LABELS[provider]} recusada pelo provedor (HTTP ${res.status})` };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Chave efetiva do agente (própria ou da organização) conferida no provedor. */
export async function checkAgentApiKey(
  admin: SupabaseClient,
  organizationId: string,
  agent: Pick<AgentRow, 'provider' | 'api_key'>
): Promise<{ ok: boolean; error?: string }> {
  const own = (agent.api_key ?? '').trim();
  const key = own || (await getOrganizationApiKey(admin, organizationId, agent.provider));
  return checkProviderApiKey(agent.provider, key);
}

export async function resolveAgentModel(
  admin: SupabaseClient,
  organizationId: string,
  agent: AgentRow
): Promise<{ model: LanguageModel; provider: AgentProvider; modelId: string }> {
  const provider = agent.provider;
  const own = (agent.api_key ?? '').trim();
  const apiKey = own || (await getOrganizationApiKey(admin, organizationId, provider));
  if (!apiKey) {
    throw new WaAgentError(
      'AI_KEY_NOT_CONFIGURED',
      `Chave da API não configurada para ${PROVIDER_LABELS[provider]}`
    );
  }
  const modelId = (agent.model || '').trim();
  if (!modelId) throw new WaAgentError('MODEL_NOT_CONFIGURED', 'Modelo não configurado no agente');
  const model = getModel(provider, apiKey, modelId) as LanguageModel;
  return { model, provider, modelId };
}
