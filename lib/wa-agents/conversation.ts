/**
 * Estado do agente numa conversa: leitura (ConversationAiInfo) e ações do
 * chat (pausar, retomar, parar, iniciar, aprovar, recusar, iniciar/cancelar
 * robô). Também expõe o robô em andamento na conversa (ConversationBotInfo).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { botConnectionIds, createBotRun } from './bots';
import { loadAgent, loadConversationContext, type WaConversationFull } from './context';
import { errorMessage } from './errors';
import type {
  AgentEvent,
  BotRunRow,
  ConversationAiAction,
  ConversationAiInfo,
  ConversationAiState,
  ConversationAiStatus,
  ConversationApproval,
  ConversationBotInfo,
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

/** O que a rota roda em segundo plano depois de responder: uma fala do agente ou a execução do robô */
export type RunAfter =
  | { kind: 'agent'; trigger: 'manual_start' | 'resume' | 'approval'; agentId: string; forceReply: boolean }
  | { kind: 'bot'; run: BotRunRow };

export type ApplyConversationActionResult =
  | { ok: true; ai: ConversationAiInfo | null; bot: ConversationBotInfo | null; runAfter?: RunAfter }
  | { ok: false; status: number; error: string };

const STATUSES: ConversationAiStatus[] = ['active', 'paused', 'stopped', 'awaiting_approval'];
/** Execuções de robô que ainda estão em andamento numa conversa */
const ACTIVE_BOT_RUN_STATUSES = ['running', 'waiting_reply'] as const;
/** Estados em que iniciar um robô precisa parar o agente da conversa */
const AGENT_LIVE_STATUSES: ConversationAiStatus[] = ['active', 'paused', 'awaiting_approval'];
/** Teto do contexto adicional guardado: o mesmo que buildSystemPrompt injeta no prompt */
const CONTEXT_MAX_CHARS = 2000;

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

/**
 * Cancela as execuções de robô em andamento ('running' ou 'waiting_reply')
 * na conversa. Devolve quantas foram canceladas. Lança em erro do banco.
 */
export async function cancelActiveBotRuns(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string
): Promise<number> {
  const { data, error } = await admin
    .from('wa_bot_runs')
    .update({ status: 'cancelled', wake_at: null, lock_until: null, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('conversation_id', conversationId)
    .in('status', [...ACTIVE_BOT_RUN_STATUSES])
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/**
 * Robô em andamento na conversa (última execução 'running'/'waiting_reply')
 * ou null. Nunca lança: erro do banco vira null (com log).
 */
export async function getConversationBotInfo(
  admin: SupabaseClient,
  input: { organizationId: string; conversationId: string }
): Promise<ConversationBotInfo | null> {
  const { organizationId, conversationId } = input;
  const { data: run, error } = await admin
    .from('wa_bot_runs')
    .select('id, bot_id, status')
    .eq('organization_id', organizationId)
    .eq('conversation_id', conversationId)
    .in('status', [...ACTIVE_BOT_RUN_STATUSES])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[wa-agents] robô da conversa falhou:', error.message);
    return null;
  }
  if (!run) return null;
  const row = run as { id: string; bot_id: string; status: ConversationBotInfo['status'] };
  const { data: bot } = await admin
    .from('wa_bots')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('id', row.bot_id)
    .maybeSingle();
  return {
    runId: row.id,
    botId: row.bot_id,
    name: (bot as { name?: string } | null)?.name ?? 'Robô',
    status: row.status,
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
    /** start_bot: robô (wa_bots) a iniciar nesta conversa */
    botId?: string;
    /** start / start_bot / set_context: contexto adicional escrito pela equipe (opcional) */
    context?: string;
    /** set_context: acrescenta ao contexto que já existe em vez de substituir */
    appendContext?: boolean;
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

    // Agente externo (n8n via API pública) = ai_status preenchido sem agente nativo.
    // Parar vale também para ele (a API pública passa a devolver AGENT_STOPPED) e
    // iniciar um agente nativo vale em qualquer estado: ele assume a conversa.
    const patch: Record<string, unknown> = { ai_status_changed_at: now };
    let event: AgentEvent | null = null;
    let eventAgentId: string | null = conv.ai_agent_id;
    let extra: Record<string, unknown> = {};
    let runAfter: RunAfter | undefined;
    /** start_bot: robô já validado; a execução é criada depois de gravar o estado do agente */
    let botToStart: { id: string; name: string } | null = null;

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
        if (conv.ai_agent_id) {
          runAfter = { kind: 'agent', trigger: 'resume', agentId: conv.ai_agent_id, forceReply: false };
        }
        break;
      }
      case 'stop': {
        if (!conv.ai_status && !conv.ai_agent_id) return fail(409, 'Nenhum agente nesta conversa');
        patch.ai_status = 'stopped';
        patch.ai_resume_at = null;
        patch.ai_approval = null;
        // parada MANUAL: ai_paused_by guarda quem parou e nada automático (palavra-chave,
        // relógio, pipeline) reabre a conversa; só Iniciar no chat
        patch.ai_paused_by = userId;
        event = 'stopped';
        break;
      }
      case 'start': {
        if (!input.agentId) return fail(400, 'Informe o agente');
        const agent = await loadAgent(admin, organizationId, input.agentId);
        if (!agent) return fail(404, 'Agente não encontrado');
        if (!agent.enabled) return fail(409, 'Este agente está desligado');
        // Um robô em andamento e um agente não falam ao mesmo tempo na conversa
        await cancelActiveBotRuns(admin, organizationId, conversationId);
        patch.ai_agent_id = agent.id;
        patch.ai_status = 'active';
        // Estado novo, preservando "Limpar memória" (memoria_desde) e levando o contexto da equipe
        patch.ai_state = {
          ...(conv.ai_state?.memoria_desde ? { memoria_desde: conv.ai_state.memoria_desde } : {}),
          ...(input.context?.trim() ? { contexto_extra: input.context.trim() } : {}),
        };
        patch.ai_approval = null;
        patch.ai_last_processed_at = null;
        patch.ai_resume_at = null;
        patch.ai_paused_by = null;
        event = 'started';
        eventAgentId = agent.id;
        extra = { by_user_id: userId };
        // "Ao ser ativado": fala primeiro (padrão) ou fica ativo e responde à próxima mensagem do contato
        if (agent.start_mode !== 'wait_reply') {
          runAfter = { kind: 'agent', trigger: 'manual_start', agentId: agent.id, forceReply: true };
        }
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
          // o teto de respostas é por agente: o próximo começa do zero
          respostas: 0,
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
        runAfter = { kind: 'agent', trigger: 'approval', agentId: next.id, forceReply: true };
        break;
      }
      case 'reject': {
        if (conv.ai_status !== 'awaiting_approval') return fail(409, 'Não há aprovação pendente');
        const approval = parseApproval(conv.ai_approval);
        patch.ai_status = 'stopped';
        patch.ai_approval = null;
        patch.ai_resume_at = null;
        patch.ai_paused_by = userId; // parada manual (ver 'stop')
        event = 'rejected';
        extra = { next_agent_id: approval?.nextAgentId ?? null, resumo: approval?.summary ?? '', by_user_id: userId };
        break;
      }
      case 'start_bot': {
        if (!input.botId) return fail(400, 'Informe o robô');
        const { data: botRow, error: botErr } = await admin
          .from('wa_bots')
          .select('id, name, enabled, connection_id, connection_ids')
          .eq('organization_id', organizationId)
          .eq('id', input.botId)
          .maybeSingle();
        if (botErr) return fail(500, botErr.message);
        const bot = botRow as {
          id: string;
          name: string;
          enabled: boolean;
          connection_id: string | null;
          connection_ids: string[] | null;
        } | null;
        if (!bot) return fail(404, 'Robô não encontrado');
        if (!bot.enabled) return fail(409, 'Este robô está desligado');
        // O robô é exclusivo dos números escolhidos nele
        const numerosDoBot = botConnectionIds({
          connection_ids: bot.connection_ids ?? [],
          connection_id: bot.connection_id,
        });
        if (conv.connection_id && numerosDoBot.length > 0 && !numerosDoBot.includes(conv.connection_id)) {
          return fail(409, `O robô "${bot.name}" não atende o número desta conversa`);
        }
        await cancelActiveBotRuns(admin, organizationId, conversationId);
        // O robô assume a conversa: agente em andamento (nativo ou externo) para
        if (conv.ai_status && AGENT_LIVE_STATUSES.includes(conv.ai_status)) {
          patch.ai_status = 'stopped';
          patch.ai_approval = null;
          patch.ai_resume_at = null;
          patch.ai_paused_by = userId; // parada manual (ver 'stop')
          if (conv.ai_agent_id) {
            event = 'stopped';
            extra = { by: 'bot_start', bot_id: bot.id };
          }
        }
        botToStart = { id: bot.id, name: bot.name };
        break;
      }
      case 'cancel_bot': {
        // Só o robô: o agente da conversa fica como está
        const cancelled = await cancelActiveBotRuns(admin, organizationId, conversationId);
        if (cancelled === 0) return fail(409, 'Nenhum robô em andamento nesta conversa');
        const ai = await getConversationAiInfo(admin, conv);
        const bot = await getConversationBotInfo(admin, { organizationId, conversationId });
        return { ok: true, ai, bot };
      }
      case 'set_context': {
        // Só guarda o contexto da equipe: estado, agente e memória ficam como estão
        const texto = (input.context ?? '').trim();
        if (!texto) return fail(400, 'Informe o contexto');
        if (!conv.ai_status && !conv.ai_agent_id) {
          return fail(409, 'Nenhum agente nesta conversa. Inicie um agente com o contexto');
        }
        // O motor lê e regrava o ai_state INTEIRO enquanto segura a trava da conversa:
        // gravar por baixo dele seria perdido em silêncio. Com o agente respondendo, recusa.
        const travadoAte = Date.parse(conv.ai_lock_until ?? '') || 0;
        if (travadoAte > Date.now()) {
          return fail(409, 'O agente está respondendo agora; tente de novo em alguns segundos');
        }
        const state: ConversationAiState = { ...((conv.ai_state ?? {}) as ConversationAiState) };
        const anterior = (state.contexto_extra ?? '').trim();
        const juntos = input.appendContext && anterior ? `${anterior}\n${texto}` : texto;
        // buildSystemPrompt corta o contexto em 2000 caracteres pelo começo: guardamos o fim
        state.contexto_extra = juntos.length > CONTEXT_MAX_CHARS ? juntos.slice(-CONTEXT_MAX_CHARS) : juntos;
        const { error: ctxErr } = await admin
          .from('wa_conversations')
          .update({ ai_state: state })
          .eq('id', conversationId)
          .eq('organization_id', organizationId);
        if (ctxErr) return fail(500, ctxErr.message);
        const ai = await getConversationAiInfo(admin, { ...conv, ai_state: state } as WaConversationFull);
        const bot = await getConversationBotInfo(admin, { organizationId, conversationId });
        return { ok: true, ai, bot };
      }
      case 'reset_memory': {
        // "Limpar memória": o agente para, esquece o que veio antes (só enxerga mensagens a partir
        // de agora) e a conversa volta a "sem agente", como um contato novo. O histórico do chat
        // continua visível para a equipe; robôs em andamento são cancelados.
        await cancelActiveBotRuns(admin, organizationId, conversationId);
        const { error: resetErr } = await admin
          .from('wa_conversations')
          .update({
            ai_agent_id: null,
            ai_status: null,
            ai_status_changed_at: now,
            ai_state: { memoria_desde: now },
            ai_last_processed_at: null,
            ai_approval: null,
            ai_resume_at: null,
            ai_paused_by: null,
          })
          .eq('id', conversationId)
          .eq('organization_id', organizationId);
        if (resetErr) return fail(500, resetErr.message);
        return { ok: true, ai: null, bot: null };
      }
      default:
        return fail(400, 'Ação inválida');
    }

    // start_bot sem agente em andamento não mexe na conversa (só o carimbo mudaria)
    let updated: WaConversationFull = conv;
    if (Object.keys(patch).length > 1) {
      const { data, error } = await admin
        .from('wa_conversations')
        .update(patch)
        .eq('id', conversationId)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();
      if (error) return fail(500, error.message);
      if (!data) return fail(404, 'Conversa não encontrada');
      updated = data as WaConversationFull;
    }

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

    let bot: ConversationBotInfo | null;
    if (botToStart) {
      // Execução criada agora (a rota processa em segundo plano); telefone, contato e negócio vêm da conversa
      const created = await createBotRun(admin, {
        organizationId,
        botId: botToStart.id,
        conversationId,
        dealId: conv.deal_id,
        contactId: conv.contact_id,
        phone: conv.wa_phone,
        context: input.context ?? null,
      });
      if (!created.ok || !created.run) return fail(400, created.error ?? 'Falha ao iniciar o robô');
      runAfter = { kind: 'bot', run: created.run };
      bot = { runId: created.run.id, botId: botToStart.id, name: botToStart.name, status: 'running' };
    } else {
      bot = await getConversationBotInfo(admin, { organizationId, conversationId });
    }

    const ai = await getConversationAiInfo(admin, updated);
    return runAfter ? { ok: true, ai, bot, runAfter } : { ok: true, ai, bot };
  } catch (e) {
    return fail(500, errorMessage(e));
  }
}
