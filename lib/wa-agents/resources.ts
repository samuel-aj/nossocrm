/**
 * Recursos de um agente para o prompt e as ferramentas: documentos prontos,
 * mídias e agentes auxiliares (da org, ligados, diferentes do próprio). SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAgentRow } from './context';
import { loadReadyDocuments } from './knowledge';
import type { AgentMediaRow, AgentResources, AgentRow } from './types';

export const MEDIA_COLUMNS =
  'id, organization_id, agent_id, name, description, kind, mime, size_bytes, storage_path, outbox_path, created_at';

/** Mídias de um agente (ordem de cadastro). */
export async function loadAgentMedia(
  admin: SupabaseClient,
  organizationId: string,
  agentId: string
): Promise<AgentMediaRow[]> {
  const { data } = await admin
    .from('wa_ai_agent_media')
    .select(MEDIA_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true });
  return (data ?? []) as AgentMediaRow[];
}

/** Agentes auxiliares válidos: da org, ligados e diferentes do próprio agente (na ordem dos ids). */
export async function loadHelperAgents(
  admin: SupabaseClient,
  organizationId: string,
  agent: Pick<AgentRow, 'id' | 'helper_agent_ids'>
): Promise<AgentRow[]> {
  const ids = Array.from(new Set((agent.helper_agent_ids ?? []).filter(id => id && id !== agent.id)));
  if (ids.length === 0) return [];
  const { data } = await admin
    .from('wa_ai_agents')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('enabled', true)
    .in('id', ids);
  const byId = new Map<string, AgentRow>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const a = normalizeAgentRow(row);
    byId.set(a.id, a);
  }
  return ids.map(id => byId.get(id)).filter((a): a is AgentRow => !!a);
}

/** Carrega documentos prontos, mídias e auxiliares do agente (falhas viram listas vazias). */
export async function loadAgentResources(
  admin: SupabaseClient,
  organizationId: string,
  agent: AgentRow
): Promise<AgentResources> {
  const [documents, media, helpers] = await Promise.all([
    loadReadyDocuments(admin, organizationId, agent.id).catch(() => []),
    loadAgentMedia(admin, organizationId, agent.id).catch(() => []),
    loadHelperAgents(admin, organizationId, agent).catch(() => []),
  ]);
  return { documents, media, helpers };
}
