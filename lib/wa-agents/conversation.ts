/**
 * Estado do agente numa conversa: leitura (ConversationAiInfo) e ações do
 * chat (pausar, retomar, parar, iniciar, aprovar, recusar).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAgent, loadConversationContext, type WaConversationFull } from './context';
import { errorMessage } from './errors';
import type {
  AgentEvent,
  ConversationAiAction,
  ConversationAiInfo,
  ConversationAiState,
  ConversationAiStatus,
  ConversationApproval,
} from './types';
import { dispatchAgentEvent } from './webhooks';

export type ConversationAiFields = {
  id: string;
  organization_id: string;
  ai_status: string | null;
  ai_agent_id: string | null;
  ai_resume_at: string | null;
  ai_approval: unknown;
};

export type AgentNameEntry = { id: string; name: string; persona_name: string | null };

export type RunAfter = {
  trigger: 'manual_start' | 'resume' | 'approval';
  agentId: string;
  forceReply: boolean;
};

export type ApplyConversationActionResult =
  | { ok: true; ai: ConversationAiInfo | null; runAfter?: RunAfter }
  | { ok: false; status: number; error: string };

const STATUSES: ConversationAiStatus[] = ['active', 'paused', 'stopped', 'awaiting_approval'];

/** Lê `ai_approval` (jsonb) com tolerância a lixo. */
export function parseApproval(raw: unknown): ConversationApproval | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.nextAgentId !== 'string' || !r.nextAgentId) return null;
  return {
    nextAgentId: r.nextAgentId,
    nextAgentName: typeof r.nextAgentName === 'string' ? r.nextAgentName : '',
    summary: typeof r.summary === 'string' ? r.summary : '',
    requestedAt: typeof r.requestedAt === 'string' ? r.requestedAt : '',
  };
}

export async function getConversationAiInfo(
  admin: SupabaseClient,
  conv: ConversationAiFields,
  agentsById?: Map<string, AgentNameEntry>
): Promise<ConversationAiInfo | null> {
  if (!conv.ai_status || !STATUSES.includes(conv.ai_status as ConversationAiStatus)) return null;
  const status = conv.ai_status as ConversationAiStatus;

  let agent: AgentNameEntry | null = null;
  if (conv.ai_agent_id) {
    const cached = agentsById?.get(conv.ai_agent_id);
    if (cached) {
      agent = { id: cached.id, name: cached.name, persona_name: cached.persona_name ?? null };
    } else {
      const { data } = await admin
        .from('wa_ai_agents')
        .select('id, name, persona_name')
        .eq('organization_id', conv.organization_id)
        .eq('id', conv.ai_agent_id)
        .maybeSingle();
      agent = (data as AgentNameEntry | null) ?? null;
    }
  }

  return {
    conversationId: conv.id,
    status,
    native: !!conv.ai_agent_id,
    agent,
    resumeAt: conv.ai_resume_at ?? null,
    approval: status === 'awaiting_approval' ? parseApproval(conv.ai_approval) : null,
  };
}

function fail(status: number, error: string): ApplyConversationActionResult {
  return { ok: false, status, error };
}

export async function applyConversationAction(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    action: ConversationAiAction;
    agentId?: string;
    userId?: string | null;
  }
): Promise<ApplyConversationActionResult> {
  const { organizationId, conversationId, action } = input;
  const userId = input.userId ?? null;
  try {
    const { data: raw, error: loadErr } = await admin
      .from('wa_conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (loadErr) return fail(500, loadErr.message);
    if (!raw) return fail(404, 'Conversa não encontrada');
    const conv = raw as WaConversationFull;
    const now = new Date().toISOString();

    // Agente externo (n8n via API pública): ai_status preenchido sem agente nativo.
    // Só pausar/retomar fazem sentido; parar/iniciar quebrariam o fluxo de fora.
    const external = !conv.ai_agent_id && !!conv.ai_status;
    if (external && (action === 'stop' || action === 'start')) {
      return fail(409, 'Esta conversa é atendida por um agente externo (API). Use pausar/retomar.');
    }

    const patch: Record<string, unknown> = { ai_status_changed_at: now };
    let event: AgentEvent | null = null;
    let eventAgentId: string | null = conv.ai_agent_id;
    let extra: Record<string, unknown> = {};
    let runAfter: RunAfter | undefined;

    switch (action) {
      case 'pause': {
        if (!conv.ai_status) return fail(409, 'Nenhum agente nesta conversa');
        if (conv.ai_status === 'stopped') return fail(409, 'O agente está parado. Inicie um agente para continuar');
        if (conv.ai_status === 'awaiting_approval') return fail(409, 'Aprove ou recuse a passagem antes de pausar');
        patch.ai_status = 'paused';
        patch.ai_resume_at = null;
        patch.ai_paused_by = userId;
        event = 'paused_by_human';
        break;
      }
      case 'resume': {
        if (conv.ai_status !== 'paused') return fail(409, 'A conversa não está pausada');
        patch.ai_status = 'active';
        patch.ai_resume_at = null;
        patch.ai_paused_by = null;
        event = 'resumed';
        if (conv.ai_agent_id) runAfter = { trigger: 'resume', agentId: conv.ai_agent_id, forceReply: false };
        break;
      }
      case 'stop': {
        if (!conv.ai_status && !conv.ai_agent_id) return fail(409, 'Nenhum agente nesta conversa');
        patch.ai_status = 'stopped';
        patch.ai_resume_at = null;
        patch.ai_approval = null;
        patch.ai_paused_by = null;
        event = 'stopped';
        break;
      }
      case 'start': {
        if (!input.agentId) return fail(400, 'Informe o agente');
        const agent = await loadAgent(admin, organizationId, input.agentId);
        if (!agent) return fail(404, 'Agente não encontrado');
        if (!agent.enabled) return fail(409, 'Este agente está desligado');
        patch.ai_agent_id = agent.id;
        patch.ai_status = 'active';
        patch.ai_state = {};
        patch.ai_approval = null;
        patch.ai_last_processed_at = null;
        patch.ai_resume_at = null;
        patch.ai_paused_by = null;
        event = 'started';
        eventAgentId = agent.id;
        extra = { by_user_id: userId };
        runAfter = { trigger: 'manual_start', agentId: agent.id, forceReply: true };
        break;
      }
      case 'approve': {
        const approval = parseApproval(conv.ai_approval);
        if (conv.ai_status !== 'awaiting_approval' || !approval) return fail(409, 'Não há aprovação pendente');
        const next = await loadAgent(admin, organizationId, approval.nextAgentId);
        if (!next) return fail(404, 'Agente de destino não encontrado');
        if (!next.enabled) return fail(409, 'O agente de destino está desligado');
        const current = conv.ai_agent_id ? await loadAgent(admin, organizationId, conv.ai_agent_id) : null;
        const state: ConversationAiState = {
          ...((conv.ai_state ?? {}) as ConversationAiState),
          handoff: {
            from_agent_id: conv.ai_agent_id ?? '',
            from_agent_name: current ? current.persona_name || current.name : '',
            summary: approval.summary,
            at: now,
          },
        };
        patch.ai_agent_id = next.id;
        patch.ai_status = 'active';
        patch.ai_state = state;
        patch.ai_approval = null;
        patch.ai_resume_at = null;
        patch.ai_paused_by = null;
        event = 'approved';
        extra = { next_agent: { id: next.id, name: next.name }, resumo: approval.summary, by_user_id: userId };
        runAfter = { trigger: 'approval', agentId: next.id, forceReply: true };
        break;
      }
      case 'reject': {
        if (conv.ai_status !== 'awaiting_approval') return fail(409, 'Não há aprovação pendente');
        const approval = parseApproval(conv.ai_approval);
        patch.ai_status = 'stopped';
        patch.ai_approval = null;
        patch.ai_resume_at = null;
        event = 'rejected';
        extra = { next_agent_id: approval?.nextAgentId ?? null, resumo: approval?.summary ?? '', by_user_id: userId };
        break;
      }
      default:
        return fail(400, 'Ação inválida');
    }

    const { data: updated, error } = await admin
      .from('wa_conversations')
      .update(patch)
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .select('*')
      .maybeSingle();
    if (error) return fail(500, error.message);
    if (!updated) return fail(404, 'Conversa não encontrada');

    // Webhook do evento (best-effort; nunca derruba a ação)
    if (event && eventAgentId) {
      try {
        const agent = await loadAgent(admin, organizationId, eventAgentId);
        if (agent) {
          const ctx = await loadConversationContext(admin, organizationId, conversationId);
          await dispatchAgentEvent(admin, { agent, event, ctx, extra });
        }
      } catch (e) {
        console.error('[wa-agents] webhook da ação falhou:', errorMessage(e));
      }
    }

    const ai = await getConversationAiInfo(admin, updated as WaConversationFull);
    return runAfter ? { ok: true, ai, runAfter } : { ok: true, ai };
  } catch (e) {
    return fail(500, errorMessage(e));
  }
}
