/**
 * Motor dos agentes de IA nativos: recebe a mensagem, decide qual agente
 * responde, gera a resposta com o modelo, envia pelo WhatsApp e aplica a
 * esteira do encerramento. Nada aqui lança sem registrar a execução.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateText,
  hasToolCall,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type StopCondition,
} from 'ai';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { getProvider, type SendResult } from '@/lib/whatsapp';
import { recordOutboundMessage, replicateOutboundToSiblings } from '@/lib/whatsapp/service';
import { executeCustomAction, executeOutcomeActions, type OutcomeActionsResult } from './actions';
import { isWaAgentsBetaEnabled } from './beta';
import { handleBotReply } from './bots';
import {
  AGENT_SOURCES,
  buildHistoryMessages,
  buildSystemPrompt,
  loadAgent,
  loadConversationContext,
  messageText,
  MESSAGE_LITE_COLUMNS,
  normalizeAgentRow,
  transitionActionKeys,
  type ConversationContext,
  type WaMessageLite,
} from './context';
import { errorMessage, WaAgentError } from './errors';
import { consultHelperAgent } from './helpers';
import { searchKnowledge } from './knowledge';
import { sendAgentMedia } from './media';
import { resolveAgentModel, supportsTemperature } from './model';
import { loadAgentResources } from './resources';
import { logRun } from './runs';
import { mergeSavedDataInto, NO_REPLY_TOKEN, sanitizeSavedData } from './savedData';
import { splitLines } from './split';
import { normalizeKeyword } from './text';
import { buildAgentTools, findByName, type AgentToolRuntime } from './tools';
import { pickInboundAgent } from './triggers';
import type {
  AgentEvent,
  AgentResources,
  AgentRow,
  AgentRunEvent,
  BotRunRow,
  ConversationAiState,
  ConversationApproval,
  CustomAction,
  KnowledgeHit,
  Outcome,
  RunStatus,
  RunTrigger,
} from './types';
import { dispatchAgentEvent } from './webhooks';

export type RunResult = {
  status: RunStatus;
  reason?: string;
  runId?: string | null;
  text?: string;
  lines?: string[];
};

export type RunAgentInput = {
  organizationId: string;
  conversationId: string;
  trigger: RunTrigger;
  agentId?: string;
  forceReply?: boolean;
  skipBuffer?: boolean;
  triggerMessageId?: string;
  depth?: number;
};

export type CollectedToolCall = { tool: string; input: unknown; output?: unknown };

export { NO_REPLY_TOKEN };
const LOCK_BASE_SECONDS = 90;
const LOCK_RETRY_MS = 2_000;
const LOCK_WAIT_MAX_MS = 60_000;
const MAX_HANDOFF_DEPTH = 3;
/**
 * Passos do modelo por resposta: consulta (documentos/auxiliar/calculadora) +
 * texto + salvar_dados + executar_acao/enviar_midia + encerrar_atendimento.
 */
const MAX_STEPS = 6;
/** Trechos da base de conhecimento injetados automaticamente no prompt. */
const AUTO_KNOWLEDGE_LIMIT = 3;
/** Trechos devolvidos pela ferramenta consultar_documentos. */
const TOOL_KNOWLEDGE_LIMIT = 5;
/** Consultas a agentes auxiliares por resposta (cada uma é outra chamada ao modelo). */
export const MAX_HELPER_CALLS_PER_RUN = 2;
/** Consultas à base de conhecimento (consultar_documentos) por resposta. */
export const MAX_KNOWLEDGE_CALLS_PER_RUN = 3;
/** Limite por conversa: execuções por mensagem recebida numa janela de minutos. */
export const RATE_WINDOW_MINUTES = 10;
export const RATE_MAX_RUNS = 20;
/** Orçamento de tokens por organização em 24 h (janela móvel); env WA_AGENTS_DAILY_TOKEN_LIMIT (0 desliga). */
export const DEFAULT_DAILY_TOKEN_LIMIT = 5_000_000;
/** Acima do orçamento a conversa pausa por este tempo (a retomada confere de novo). */
const BUDGET_PAUSE_MINUTES = 60;

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Duração da trava por conversa: geração + envio das linhas (até 8) + webhooks
 * (por evento e das ações) + consultas a agentes auxiliares (cada uma é outra
 * chamada ao modelo) + cópia/envio das mídias (`mediaCount`, até 3).
 */
export function lockSecondsFor(
  agent: Pick<AgentRow, 'line_delay_ms' | 'webhooks' | 'outcomes' | 'custom_actions'> & Partial<Pick<AgentRow, 'helper_agent_ids'>>,
  opts: { mediaCount?: number } = {}
): number {
  const activeWebhooks = agent.webhooks.filter(w => w.active !== false).length;
  const actionWebhooks = [...(agent.outcomes ?? []), ...(agent.custom_actions ?? [])].reduce(
    (n, item) => n + (item.actions ?? []).filter(a => a.type === 'webhook').length,
    0
  );
  const helpers = Math.min((agent.helper_agent_ids ?? []).length, 3);
  const media = Math.min(Math.max(0, opts.mediaCount ?? 0), 3);
  return (
    LOCK_BASE_SECONDS +
    Math.ceil((8 * agent.line_delay_ms) / 1000) +
    25 * (activeWebhooks + actionWebhooks) +
    30 * helpers +
    20 * media
  );
}

/** Orçamento diário de tokens por org: env WA_AGENTS_DAILY_TOKEN_LIMIT (0 desliga) ou o padrão. */
export function dailyTokenLimit(): number {
  const raw = process.env.WA_AGENTS_DAILY_TOKEN_LIMIT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAILY_TOKEN_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_TOKEN_LIMIT;
}

/** Tokens usados pela org nas últimas 24 h (RPC wa_ai_agent_usage_tokens). Em erro, 0 (não bloqueia). */
async function orgTokensLast24h(admin: SupabaseClient, organizationId: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { data, error } = await admin.rpc('wa_ai_agent_usage_tokens', { p_org: organizationId, p_since: since });
    if (error) {
      console.error('[wa-agents] consulta de uso de tokens falhou:', error.message);
      return 0;
    }
    const n = Number(data);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    console.error('[wa-agents] consulta de uso de tokens falhou:', errorMessage(e));
    return 0;
  }
}

/** true quando a conversa já teve RATE_MAX_RUNS execuções por mensagem recebida na janela. Em erro, false. */
async function inboundRateLimited(admin: SupabaseClient, organizationId: string, conversationId: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString();
    const { count, error } = await admin
      .from('wa_ai_agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('conversation_id', conversationId)
      .eq('trigger', 'inbound')
      .gte('created_at', since);
    if (error) return false;
    return (count ?? 0) >= RATE_MAX_RUNS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ferramentas do modelo (definidas em tools.ts)
// ---------------------------------------------------------------------------
export { buildAgentTools };

/** Acha a ação durante a conversa pela chave (fallback: igual ignorando caixa; depois pelo rótulo). */
export function findCustomAction(actions: CustomAction[], key: string): CustomAction | null {
  const k = (key || '').trim();
  if (!k) return null;
  return (
    actions.find(a => a.key === k) ??
    actions.find(a => a.key.toLowerCase() === k.toLowerCase()) ??
    actions.find(a => a.label.trim().toLowerCase() === k.toLowerCase()) ??
    null
  );
}

/**
 * Pedaço da resposta na ordem em que o modelo produziu: texto (dividido em
 * linhas na hora do envio) ou mídia pedida por enviar_midia. Assim a mídia é
 * entregue no ponto da conversa em que a ferramenta foi chamada.
 */
export type ReplySegment = { kind: 'text'; text: string } | { kind: 'media'; name: string; caption?: string };

export type GeneratedReply = {
  text: string;
  segments: ReplySegment[];
  toolCalls: CollectedToolCall[];
  usage: unknown;
  finishReason: string;
};

export { supportsTemperature, pickInboundAgent };

/** Chama o modelo com as ferramentas do agente e junta texto/ferramentas de todos os passos. */
export async function generateAgentReply(input: {
  model: LanguageModel;
  agent: AgentRow;
  system: string;
  messages: ModelMessage[];
  /** Recursos e efeitos das ferramentas condicionais (documentos, mídias, auxiliares) */
  runtime?: AgentToolRuntime;
}): Promise<GeneratedReply> {
  // Ação durante a conversa com transição (parar, passar, aprovação) também encerra a geração:
  // o texto de um passo seguinte iria para um lead que já não é deste agente
  const finals = transitionActionKeys(input.agent);
  const hasTransitionAction: StopCondition<any> = ({ steps }) => {
    const last = steps[steps.length - 1];
    if (!last) return false;
    return last.toolCalls.some(tc => {
      const call = tc as { toolName: string; input?: unknown };
      const acao = (call.input as { acao?: unknown } | undefined)?.acao;
      return call.toolName === 'executar_acao' && finals.has(String(acao ?? ''));
    });
  };
  const result = await generateText({
    model: input.model,
    system: input.system,
    messages: input.messages,
    temperature: supportsTemperature(input.agent) ? input.agent.temperature : undefined,
    tools: buildAgentTools(input.agent, input.runtime),
    // Depois de encerrar_atendimento não há passo extra: o texto sobrando iria para o lead
    stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('encerrar_atendimento'), hasTransitionAction],
  });

  const toolCalls: CollectedToolCall[] = [];
  const texts: string[] = [];
  const segments: ReplySegment[] = [];
  for (const step of result.steps) {
    const t = (step.text ?? '').trim();
    if (t) {
      texts.push(t);
      segments.push({ kind: 'text', text: t });
    }
    for (const tc of step.toolCalls) {
      const tr = step.toolResults.find(r => r.toolCallId === tc.toolCallId);
      toolCalls.push({ tool: tc.toolName, input: tc.input, output: tr?.output });
      if (tc.toolName === 'enviar_midia') {
        const out = (tr?.output ?? null) as { ok?: boolean; midia?: string } | null;
        const args = (tc.input ?? {}) as { nome?: string; legenda?: string };
        if (out?.ok) {
          segments.push({ kind: 'media', name: out.midia || String(args.nome ?? ''), caption: args.legenda });
        }
      }
    }
  }
  // Legenda repetida no texto: o modelo costuma escrever a mesma frase na legenda da mídia e
  // na resposta; sem isto o lead recebe a frase duas vezes (na mídia e como mensagem solta)
  const captions = segments
    .map(s => (s.kind === 'media' ? normalizeKeyword(s.caption ?? '') : ''))
    .filter(Boolean);
  if (captions.length > 0) {
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (seg.kind !== 'text') continue;
      const kept = seg.text
        .split('\n')
        .filter(line => !captions.includes(normalizeKeyword(line)))
        .join('\n')
        .trim();
      if (kept) segments[i] = { kind: 'text', text: kept };
      else segments.splice(i, 1);
    }
  }
  // O texto final pode ter vindo no passo anterior ao da ferramenta: junta todos
  const text = (texts.join('\n') || result.text || '').trim();
  // Sem mídia, um único segmento com o texto todo (mesma divisão em linhas de antes)
  if (!segments.some(s => s.kind === 'media')) {
    segments.length = 0;
    if (text) segments.push({ kind: 'text', text });
  }
  const u = result.totalUsage;
  const usage = {
    inputTokens: u?.inputTokens ?? null,
    outputTokens: u?.outputTokens ?? null,
    totalTokens: u?.totalTokens ?? null,
  };
  return { text, segments, toolCalls, usage, finishReason: String(result.finishReason ?? '') };
}

/** Texto de um segmento sem o marcador [SEM_RESPOSTA] ('' quando só havia o marcador). */
export function segmentText(seg: ReplySegment): string {
  if (seg.kind !== 'text') return '';
  return seg.text.split(NO_REPLY_TOKEN).join('').trim();
}

/** Dados salvos via salvar_dados (mesclados na ordem das chamadas e saneados: chaves curtas, valores primitivos). */
export function mergeSavedData(toolCalls: CollectedToolCall[]): Record<string, unknown> | null {
  let merged: Record<string, unknown> | null = null;
  for (const tc of toolCalls) {
    if (tc.tool !== 'salvar_dados') continue;
    const dados = (tc.input as { dados?: unknown } | null)?.dados;
    if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
      merged = { ...(merged ?? {}), ...(dados as Record<string, unknown>) };
    }
  }
  return merged ? sanitizeSavedData(merged) : null;
}

/** Acha o resultado pela chave (fallback: igual ignorando caixa/espaços). */
export function findOutcome(outcomes: Outcome[], key: string): Outcome | null {
  const k = (key || '').trim();
  if (!k) return null;
  return (
    outcomes.find(o => o.key === k) ??
    outcomes.find(o => o.key.toLowerCase() === k.toLowerCase()) ??
    outcomes.find(o => o.label.trim().toLowerCase() === k.toLowerCase()) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Consultas auxiliares
// ---------------------------------------------------------------------------
async function getLastMessage(
  admin: SupabaseClient,
  ctx: ConversationContext,
  direction: 'in' | 'out' | null
): Promise<WaMessageLite | null> {
  let q = admin
    .from('wa_messages')
    .select(MESSAGE_LITE_COLUMNS)
    .eq('organization_id', ctx.conversation.organization_id)
    .eq('conversation_id', ctx.conversation.id);
  if (direction) q = q.eq('direction', direction);
  const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as WaMessageLite | null) ?? null;
}

async function getPendingInbound(
  admin: SupabaseClient,
  ctx: ConversationContext,
  sinceIso: string
): Promise<WaMessageLite[]> {
  const { data } = await admin
    .from('wa_messages')
    .select(MESSAGE_LITE_COLUMNS)
    .eq('organization_id', ctx.conversation.organization_id)
    .eq('conversation_id', ctx.conversation.id)
    .eq('direction', 'in')
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(50);
  return (data ?? []) as WaMessageLite[];
}

/**
 * Pega a trava da conversa. Devolve o valor gravado em ai_lock_until (quem o
 * conhece é o dono: só ele renova e libera) ou null se não conseguiu.
 */
async function claimLock(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  seconds: number
): Promise<string | null> {
  const deadline = Date.now() + LOCK_WAIT_MAX_MS;
  for (;;) {
    const { data, error } = await admin.rpc('wa_ai_claim_lock', {
      p_org: organizationId,
      p_conversation: conversationId,
      p_seconds: seconds,
    });
    if (error) throw new WaAgentError('LOCK_ERROR', error.message);
    if (data === true) {
      const { data: row } = await admin
        .from('wa_conversations')
        .select('ai_lock_until')
        .eq('id', conversationId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      // Sem leitura a trava fica com um valor que ninguém libera: expira sozinha
      return (
        (row as { ai_lock_until?: string | null } | null)?.ai_lock_until ??
        new Date(Date.now() + seconds * 1000).toISOString()
      );
    }
    if (Date.now() + LOCK_RETRY_MS > deadline) return null;
    await sleep(LOCK_RETRY_MS);
  }
}

/** Renova a trava só se ainda formos o dono. Devolve o valor vigente (novo ou o antigo). */
async function renewLock(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  current: string,
  seconds: number
): Promise<string> {
  try {
    const until = new Date(Date.now() + seconds * 1000).toISOString();
    const { data } = await admin
      .from('wa_conversations')
      .update({ ai_lock_until: until })
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .eq('ai_lock_until', current)
      .select('id')
      .maybeSingle();
    return data ? until : current;
  } catch (e) {
    console.error('[wa-agents] renovar trava falhou:', errorMessage(e));
    return current;
  }
}

/** Libera a trava só se ainda formos o dono (valor igual ao último gravado). */
async function releaseLock(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  current: string
): Promise<void> {
  try {
    await admin
      .from('wa_conversations')
      .update({ ai_lock_until: null })
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .eq('ai_lock_until', current);
  } catch (e) {
    console.error('[wa-agents] liberar trava falhou:', errorMessage(e));
  }
}

async function updateConversation(
  admin: SupabaseClient,
  ctx: ConversationContext,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await admin
    .from('wa_conversations')
    .update(patch)
    .eq('id', ctx.conversation.id)
    .eq('organization_id', ctx.conversation.organization_id);
  if (error) throw new WaAgentError('DB_ERROR', error.message);
}

// ---------------------------------------------------------------------------
// Envio das linhas
// ---------------------------------------------------------------------------
async function sendLines(
  admin: SupabaseClient,
  ctx: ConversationContext,
  agent: AgentRow,
  lines: string[],
  opts: { renewLock?: () => Promise<void> } = {}
): Promise<void> {
  const conn = ctx.connection;
  if (!conn) throw new WaAgentError('NO_CONNECTION', 'Conversa sem número vinculado');
  if (conn.status !== 'connected') throw new WaAgentError('DISCONNECTED', 'número desconectado');
  const provider = getProvider(conn);
  const orgId = ctx.conversation.organization_id;
  const to = ctx.conversation.wa_phone;

  // Trava renovada antes e depois de cada envio: o eco do webhook chega com ela ativa
  if (opts.renewLock) await opts.renewLock();
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    let result: SendResult;
    try {
      result = await provider.sendText({ to, text });
    } catch (e) {
      result = { ok: false, error: errorMessage(e) };
    }
    // A gravação no chat nunca derruba o fluxo: mensagem enviada (ou falha) fica registrada
    try {
      const msg = await recordOutboundMessage(admin, {
        orgId,
        conversationId: ctx.conversation.id,
        text,
        providerMessageId: result.providerMessageId ?? null,
        fromPhone: conn.phone_number,
        toPhone: to,
        sentBy: null,
        source: 'agent',
        status: result.ok ? 'sent' : 'failed',
        error: result.ok ? null : result.error || 'falha no envio',
      });
      if (result.ok) {
        await replicateOutboundToSiblings(admin, conn, {
          toPhone: to,
          text: msg.body,
          providerMessageId: result.providerMessageId ?? null,
        });
      }
    } catch (e) {
      console.error('[wa-agents] gravar mensagem do agente falhou:', errorMessage(e));
    }
    if (!result.ok) {
      throw new WaAgentError('SEND_FAILED', `Envio falhou na linha ${i + 1}: ${result.error || 'erro desconhecido'}`);
    }
    if (opts.renewLock) await opts.renewLock();
    if (i < lines.length - 1 && agent.line_delay_ms > 0) await sleep(agent.line_delay_ms);
  }
}

// ---------------------------------------------------------------------------
// Execução do agente numa conversa
// ---------------------------------------------------------------------------
export async function runAgentOnConversation(input: RunAgentInput): Promise<RunResult> {
  const admin = createStaticAdminClient();
  const { organizationId, conversationId, trigger } = input;
  const depth = input.depth ?? 0;
  const startedAt = Date.now();
  const events: AgentRunEvent[] = [];
  const toolCalls: CollectedToolCall[] = [];
  let agent: AgentRow | null = null;
  let ctx: ConversationContext | null = null;
  let modelId: string | null = null;
  let inputText: string | null = null;
  let outputText: string | null = null;
  let usage: unknown = null;
  // Valor gravado em ai_lock_until enquanto formos o dono da trava (null = sem trava)
  let lockValue: string | null = null;
  let lockSeconds = LOCK_BASE_SECONDS;
  let pendingHandoffAgentId: string | null = null;

  const pushEvent = (type: string, extra?: Record<string, unknown>) => {
    events.push({ type, at: new Date().toISOString(), ...(extra ?? {}) });
  };
  const emit = async (event: AgentEvent, extra?: Record<string, unknown>) => {
    pushEvent(event, extra);
    if (!agent || !ctx) return;
    const results = await dispatchAgentEvent(admin, { agent, event, ctx, extra });
    if (results.length > 0) pushEvent('webhook', { event, results });
  };
  const finish = async (
    status: RunStatus,
    extra: { reason?: string; error?: string; text?: string; lines?: string[] } = {}
  ): Promise<RunResult> => {
    const runId = await logRun(admin, {
      organization_id: organizationId,
      agent_id: agent?.id ?? input.agentId ?? null,
      conversation_id: conversationId,
      trigger,
      status,
      reason: extra.reason ?? null,
      input_text: inputText,
      output_text: outputText,
      tool_calls: toolCalls,
      events,
      usage,
      model: modelId,
      duration_ms: Date.now() - startedAt,
      error: extra.error ?? null,
    });
    return { status, reason: extra.reason, runId, text: extra.text, lines: extra.lines };
  };
  const renew = async () => {
    if (!lockValue) return;
    lockValue = await renewLock(admin, organizationId, conversationId, lockValue, lockSeconds);
  };
  const release = async () => {
    if (!lockValue) return;
    const current = lockValue;
    lockValue = null;
    await releaseLock(admin, organizationId, conversationId, current);
  };
  const stopConversation = async (reason: string, extra?: Record<string, unknown>) => {
    if (!ctx) return;
    await updateConversation(admin, ctx, {
      ai_status: 'stopped',
      ai_status_changed_at: new Date().toISOString(),
      ai_resume_at: null,
      ai_approval: null,
      // parada pelo próprio agente (não pelo atendente): palavra-chave ou pipeline podem reabrir
      ai_paused_by: null,
    });
    ctx.conversation.ai_status = 'stopped';
    await emit('stopped', { reason, ...(extra ?? {}) });
  };

  try {
    // Beta desligada no meio do caminho (retomada, passagem, robô): não responde
    if (!(await isWaAgentsBetaEnabled(admin, organizationId))) {
      return await finish('skipped', { reason: 'beta desativada' });
    }
    ctx = await loadConversationContext(admin, organizationId, conversationId);
    const agentId = input.agentId ?? ctx.conversation.ai_agent_id;
    if (!agentId) return await finish('skipped', { reason: 'sem agente' });
    agent = await loadAgent(admin, organizationId, agentId);
    if (!agent) return await finish('skipped', { reason: 'agente não encontrado' });
    if (!agent.enabled) return await finish('skipped', { reason: 'agente desligado' });
    lockSeconds = lockSecondsFor(agent);

    // 2. Buffer: espera o lead terminar de digitar; só a execução da ÚLTIMA mensagem responde
    if (!input.skipBuffer && agent.buffer_seconds > 0) await sleep(agent.buffer_seconds * 1000);
    if (input.triggerMessageId) {
      const lastIn = await getLastMessage(admin, ctx, 'in');
      if (lastIn && lastIn.id !== input.triggerMessageId) {
        return await finish('skipped', { reason: 'superseded' });
      }
    }

    // 3. Trava por conversa
    lockValue = await claimLock(admin, organizationId, conversationId, lockSeconds);
    if (!lockValue) return await finish('skipped', { reason: 'locked' });

    // 4. Estado atual (pode ter mudado durante o buffer/trava)
    ctx = await loadConversationContext(admin, organizationId, conversationId);
    const conv = ctx.conversation;
    if (conv.ai_status !== 'active') {
      return await finish('skipped', { reason: `conversa ${conv.ai_status ?? 'sem agente'}` });
    }
    if (conv.ai_agent_id !== agent.id) {
      return await finish('skipped', { reason: 'agente da conversa mudou' });
    }

    const since = conv.ai_last_processed_at ?? '1970-01-01T00:00:00.000Z';
    const pending = await getPendingInbound(admin, ctx, since);
    inputText = pending.map(messageText).filter(Boolean).join('\n') || null;
    if (!input.forceReply) {
      if (pending.length === 0) return await finish('skipped', { reason: 'nada a responder' });
      // Só saída HUMANA (crm/echo) bloqueia; as do agente, robô e API não contam
      const lastAny = await getLastMessage(admin, ctx, null);
      if (lastAny && lastAny.direction === 'out' && !(lastAny.source && AGENT_SOURCES.has(lastAny.source))) {
        return await finish('skipped', { reason: 'atendente respondeu por último' });
      }
    }

    // 4b. Orçamento diário de tokens da organização: acima do teto a conversa pausa por 1 h
    // (a retomada confere de novo) e o webhook 'error' avisa
    const tokenLimit = dailyTokenLimit();
    if (tokenLimit > 0) {
      const used = await orgTokensLast24h(admin, organizationId);
      if (used >= tokenLimit) {
        const now = new Date();
        const resumeAt = new Date(now.getTime() + BUDGET_PAUSE_MINUTES * 60_000).toISOString();
        await updateConversation(admin, ctx, {
          ai_status: 'paused',
          ai_status_changed_at: now.toISOString(),
          ai_paused_by: null,
          ai_resume_at: resumeAt,
        });
        ctx.conversation.ai_status = 'paused';
        ctx.conversation.ai_resume_at = resumeAt;
        await emit('error', {
          code: 'DAILY_TOKEN_LIMIT',
          message: `Orçamento de tokens da organização em 24 h esgotado (${used} de ${tokenLimit}); conversa pausada até ${resumeAt}`,
        });
        return await finish('skipped', { reason: 'orçamento diário de tokens esgotado' });
      }
    }

    // 5. Modelo, recursos (documentos, mídias, auxiliares), prompt e histórico
    const resolved = await resolveAgentModel(admin, organizationId, agent);
    modelId = resolved.modelId;
    const resources: AgentResources = await loadAgentResources(admin, organizationId, agent);
    // Mídias contam na trava (cópia + envio): renova já com a duração nova
    if (resources.media.length > 0) {
      lockSeconds = lockSecondsFor(agent, { mediaCount: resources.media.length });
      await renew();
    }
    // Trechos da base para a(s) última(s) mensagem(ns) do lead, injetados no prompt
    let knowledge: KnowledgeHit[] = [];
    if (resources.documents.length > 0) {
      const lastInForQuery = pending.length > 0 ? null : await getLastMessage(admin, ctx, 'in');
      const query = inputText ?? (lastInForQuery ? messageText(lastInForQuery) : '');
      if (query) {
        knowledge = await searchKnowledge(admin, { organizationId, agent, query, limit: AUTO_KNOWLEDGE_LIMIT });
        if (knowledge.length > 0) pushEvent('knowledge_injected', { trechos: knowledge.length });
      }
    }
    // Teto de respostas por atendimento (max_replies; 0 = sem limite; contador ai_state.respostas):
    // na última resposta permitida o prompt manda encerrar (mustClose) e, se o modelo não
    // encerrar, a conversa para depois do envio (passo 9d)
    const priorState = (conv.ai_state ?? {}) as ConversationAiState;
    const repliesSoFar = Number(priorState.respostas ?? 0) || 0;
    const mustClose = agent.max_replies > 0 && repliesSoFar + 1 >= agent.max_replies;
    // Instrução de apresentação só no primeiro contato pelo pipeline (não nas rodadas seguintes nem após passagem)
    const system = buildSystemPrompt({ agent, ctx, firstContact: input.trigger === 'deal', resources, knowledge, mustClose });
    const messages = await buildHistoryMessages(admin, ctx, agent.history_limit);
    if (input.forceReply && (messages.length === 0 || messages[messages.length - 1].role === 'assistant')) {
      messages.push({ role: 'user', content: '(o sistema pediu que você inicie/continue o atendimento agora)' });
    }

    // Efeitos das ferramentas condicionais. enviar_midia só enfileira: a mídia
    // sai na ordem dos segmentos (texto anterior, mídia, texto seguinte), no passo 7.
    // Cada mídia vai uma única vez por atendimento (ai_state.midias_enviadas) e
    // as consultas (auxiliares, base) têm teto por resposta.
    const runCtx = ctx;
    const runAgent = agent;
    const mediaSentBefore = new Set((priorState.midias_enviadas ?? []).map(normalizeKeyword));
    const mediaQueued = new Set<string>();
    let helperCalls = 0;
    let knowledgeCalls = 0;
    const runtime: AgentToolRuntime = {
      documents: resources.documents,
      media: resources.media,
      helpers: resources.helpers,
      searchKnowledge: async q => {
        knowledgeCalls += 1;
        if (knowledgeCalls > MAX_KNOWLEDGE_CALLS_PER_RUN) {
          throw new Error(`Limite de ${MAX_KNOWLEDGE_CALLS_PER_RUN} consultas à base de conhecimento nesta resposta atingido: responda com o que já tem`);
        }
        return searchKnowledge(admin, { organizationId, agent: runAgent, query: q, limit: TOOL_KNOWLEDGE_LIMIT });
      },
      sendMedia: async media => {
        const conn = runCtx.connection;
        if (!conn) return { ok: false, error: 'conversa sem número vinculado' };
        if (conn.status !== 'connected') return { ok: false, error: 'número desconectado' };
        const key = normalizeKeyword(media.name);
        if (mediaSentBefore.has(key) || mediaQueued.has(key)) {
          return { ok: false, error: `mídia "${media.name}" já enviada neste atendimento; não envie de novo` };
        }
        mediaQueued.add(key);
        return { ok: true, note: `mídia "${media.name}" será enviada neste ponto da conversa` };
      },
      consultHelper: async (helper, question) => {
        helperCalls += 1;
        if (helperCalls > MAX_HELPER_CALLS_PER_RUN) {
          return `Limite de ${MAX_HELPER_CALLS_PER_RUN} consultas a agentes auxiliares nesta resposta atingido: responda com o que já tem.`;
        }
        await renew();
        const answer = await consultHelperAgent(admin, { organizationId, helper, question, ctx: runCtx, askedBy: runAgent });
        await renew();
        return answer;
      },
    };

    // 6. Geração
    const gen = await generateAgentReply({ model: resolved.model, agent, system, messages, runtime });
    toolCalls.push(...gen.toolCalls);
    usage = gen.usage;
    const text = gen.text;
    outputText = text || null;

    // 7. Envio na ordem dos segmentos: linhas de texto e mídias no ponto em que foram pedidas
    const lines: string[] = [];
    const mediaSent: string[] = [];
    for (const seg of gen.segments) {
      if (seg.kind === 'text') {
        const t = segmentText(seg);
        if (!t) continue;
        const segLines = splitLines(t);
        if (lines.length > 0 && agent.line_delay_ms > 0) await sleep(agent.line_delay_ms);
        await sendLines(admin, ctx, agent, segLines, { renewLock: renew });
        lines.push(...segLines);
        continue;
      }
      const media = findByName(resources.media, seg.name);
      if (!media) {
        pushEvent('media_not_found', { nome: seg.name });
        continue;
      }
      if ((lines.length > 0 || mediaSent.length > 0) && agent.line_delay_ms > 0) await sleep(agent.line_delay_ms);
      await renew();
      const sent = await sendAgentMedia(admin, { organizationId, agent, ctx, media, caption: seg.caption });
      await renew();
      if (sent.ok) {
        mediaSent.push(media.name);
        pushEvent('media_sent', { nome: media.name, kind: media.kind, message_id: sent.messageId });
      } else {
        // O texto já foi: a falha da mídia fica registrada (e a mensagem 'failed' aparece no chat)
        pushEvent('media_failed', { nome: media.name, error: sent.error });
      }
    }

    // 8. Estado da conversa
    const lastIn = pending.length > 0 ? pending[pending.length - 1] : await getLastMessage(admin, ctx, 'in');
    const saved = mergeSavedData(gen.toolCalls);
    const state: ConversationAiState = { ...priorState };
    if (saved) state.dados = mergeSavedDataInto(state.dados, saved);
    if (mediaSent.length > 0) {
      state.midias_enviadas = Array.from(new Set([...(state.midias_enviadas ?? []), ...mediaSent]));
    }
    // Respostas enviadas neste atendimento (teto max_replies): só conta quando algo saiu
    if (lines.length > 0 || mediaSent.length > 0) state.respostas = repliesSoFar + 1;
    await updateConversation(admin, ctx, {
      ai_last_processed_at: lastIn?.created_at ?? new Date().toISOString(),
      ai_state: state,
    });
    ctx.conversation.ai_state = state;

    // 9. Eventos e esteira
    if (lines.length > 0 || mediaSent.length > 0) await emit('reply_sent', { text, lines, media: mediaSent });
    for (const tc of gen.toolCalls) await emit('tool_used', { tool: tc.tool, input: tc.input });

    // Mudança de estado pedida pelas ações (aprovação, passagem, parada): aplicada uma única vez
    // no fim. O resultado do encerramento prevalece sobre uma ação durante a conversa.
    let transition: { acts: OutcomeActionsResult; summary: string; reason: string; extra: Record<string, unknown> } | null =
      null;
    const requestsTransition = (acts: OutcomeActionsResult) =>
      !!(acts.approvalAgentId || acts.handoffAgentId || acts.stopped);

    // 9a. Ações durante a conversa (executar_acao): executam sem encerrar o atendimento.
    // Uma ação por resposta (a primeira válida); chamada sem "detalhes" é ignorada. O trecho
    // da mensagem do lead que motivou a ação fica no registro e no webhook (auditoria).
    const leadExcerpt = (inputText ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    let actionExecuted = false;
    for (const tc of gen.toolCalls) {
      if (tc.tool !== 'executar_acao') continue;
      const args = (tc.input ?? {}) as { acao?: unknown; detalhes?: unknown };
      const acao = String(args.acao ?? '').trim();
      const detalhes = String(args.detalhes ?? '').trim();
      const custom = findCustomAction(agent.custom_actions ?? [], acao);
      if (!custom) {
        pushEvent('custom_action_not_found', { acao, detalhes });
        continue;
      }
      if (!detalhes) {
        pushEvent('custom_action_ignored', { acao: custom.key, motivo: 'sem detalhes' });
        continue;
      }
      if (actionExecuted) {
        pushEvent('custom_action_skipped', { acao: custom.key, detalhes, motivo: 'uma ação por resposta' });
        continue;
      }
      actionExecuted = true;
      const acts = await executeCustomAction(admin, {
        agent,
        ctx,
        action: custom,
        details: detalhes,
        runEvents: events,
        renewLock: renew,
      });
      await emit('custom_action', { acao: custom.key, label: custom.label, detalhes, mensagem_lead: leadExcerpt });
      if (requestsTransition(acts)) {
        transition = {
          acts,
          summary: detalhes,
          reason: 'ação durante a conversa com parada',
          extra: { acao: custom.key, detalhes },
        };
      }
    }

    // 9b. Encerramento (encerrar_atendimento)
    const end = gen.toolCalls.find(t => t.tool === 'encerrar_atendimento');
    if (end) {
      const args = (end.input ?? {}) as { resultado?: unknown; resumo?: unknown };
      const resultado = String(args.resultado ?? '').trim();
      const resumo = String(args.resumo ?? '').trim();
      const outcome = findOutcome(agent.outcomes, resultado);
      if (!outcome) {
        pushEvent('outcome_not_found', { resultado, resumo });
      } else {
        const acts = await executeOutcomeActions(admin, {
          agent,
          ctx,
          outcome,
          summary: resumo,
          runEvents: events,
          renewLock: renew,
        });
        await emit('finished', { resultado: outcome.key, resultado_label: outcome.label, resumo });
        if (requestsTransition(acts)) {
          transition = { acts, summary: resumo, reason: 'resultado com parada', extra: { resultado: outcome.key, resumo } };
        }
      }
    }

    // 9c. Aprovação, passagem ou parada
    if (transition) {
      const { acts, summary, reason, extra } = transition;
      const now = new Date().toISOString();
      if (acts.approvalAgentId) {
        const next = await loadAgent(admin, organizationId, acts.approvalAgentId);
        if (!next || !next.enabled) {
          await stopConversation('agente de destino indisponível', extra);
        } else {
          const approval: ConversationApproval = {
            nextAgentId: next.id,
            nextAgentName: next.persona_name || next.name,
            summary,
            requestedAt: now,
          };
          await updateConversation(admin, ctx, {
            ai_status: 'awaiting_approval',
            ai_status_changed_at: now,
            ai_approval: approval,
          });
          ctx.conversation.ai_status = 'awaiting_approval';
          ctx.conversation.ai_approval = approval;
          await emit('awaiting_approval', { next_agent: { id: next.id, name: next.name }, resumo: summary });
        }
      } else if (acts.handoffAgentId) {
        const next = await loadAgent(admin, organizationId, acts.handoffAgentId);
        if (!next || !next.enabled) {
          await stopConversation('agente de destino indisponível', extra);
        } else {
          const handoffState: ConversationAiState = {
            ...state,
            // o teto de respostas é por agente: o próximo começa do zero
            respostas: 0,
            handoff: {
              from_agent_id: agent.id,
              from_agent_name: agent.persona_name || agent.name,
              summary,
              at: now,
            },
          };
          await updateConversation(admin, ctx, {
            ai_agent_id: next.id,
            ai_state: handoffState,
            ai_status: 'active',
            ai_status_changed_at: now,
            ai_approval: null,
          });
          ctx.conversation.ai_agent_id = next.id;
          ctx.conversation.ai_state = handoffState;
          await emit('handed_off', { to_agent: { id: next.id, name: next.name }, resumo: summary });
          pendingHandoffAgentId = next.id;
        }
      } else if (acts.stopped) {
        await stopConversation(reason, extra);
      }
    }

    // 9d. Teto de respostas: esta era a última resposta permitida e a conversa continua ativa
    // com este agente (o modelo não encerrou, encerrou com resultado inválido ou o resultado
    // não parou a conversa; sem passagem nem aprovação): para aqui
    if (mustClose && ctx.conversation.ai_status === 'active' && !pendingHandoffAgentId) {
      const extra = { max_replies: agent.max_replies, respostas: state.respostas ?? repliesSoFar };
      pushEvent('max_replies_reached', extra);
      await stopConversation('limite de respostas atingido', extra);
    }

    // 10. Registro
    const res = await finish('ok', { text, lines });

    // Passagem em cadeia: fora da trava desta execução
    if (pendingHandoffAgentId && depth < MAX_HANDOFF_DEPTH) {
      await release();
      await runAgentOnConversation({
        organizationId,
        conversationId,
        trigger: 'handoff',
        agentId: pendingHandoffAgentId,
        forceReply: true,
        skipBuffer: true,
        depth: depth + 1,
      });
    }
    return res;
  } catch (e) {
    const msg = errorMessage(e);
    const code = e instanceof WaAgentError ? e.code : undefined;
    console.error('[wa-agents] execução falhou:', msg);
    try {
      await emit('error', { message: msg, code });
    } catch {
      // nunca derruba o registro do erro
    }
    // Em erro a conversa continua 'active': a próxima mensagem tenta de novo
    return await finish('error', { reason: msg, error: msg });
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------
// Mensagem recebida (chamada pelo /api/wa-agents/ingest)
// ---------------------------------------------------------------------------
export async function handleInboundMessage(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
}): Promise<RunResult> {
  const admin = createStaticAdminClient();
  const { organizationId, conversationId, messageId } = input;
  const events: AgentRunEvent[] = [];
  const skip = async (reason: string, agentId?: string | null): Promise<RunResult> => {
    const runId = await logRun(admin, {
      organization_id: organizationId,
      agent_id: agentId ?? null,
      conversation_id: conversationId,
      trigger: 'inbound',
      status: 'skipped',
      reason,
      events,
    });
    return { status: 'skipped', reason, runId };
  };

  try {
    if (!(await isWaAgentsBetaEnabled(admin, organizationId))) {
      return { status: 'skipped', reason: 'beta desativada' };
    }

    // Robô esperando resposta nesta conversa tem prioridade
    const { data: waiting } = await admin
      .from('wa_bot_runs')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('conversation_id', conversationId)
      .eq('status', 'waiting_reply')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (waiting) {
      const { data: msg } = await admin
        .from('wa_messages')
        .select('id, body, transcription')
        .eq('organization_id', organizationId)
        .eq('id', messageId)
        .maybeSingle();
      const m = (msg as { id: string; body: string | null; transcription: string | null } | null) ?? {
        id: messageId,
        body: null,
        transcription: null,
      };
      await handleBotReply(admin, { run: waiting as BotRunRow, message: m });
      return { status: 'ok', reason: 'robô' };
    }

    let ctx = await loadConversationContext(admin, organizationId, conversationId);
    const conv = ctx.conversation;
    let agent: AgentRow | null = null;

    // Mensagem que disparou (texto ou transcrição): gatilhos por palavra-chave e evento
    const { data: msgRow } = await admin
      .from('wa_messages')
      .select(MESSAGE_LITE_COLUMNS)
      .eq('organization_id', organizationId)
      .eq('id', messageId)
      .maybeSingle();
    const text = msgRow ? messageText(msgRow as WaMessageLite) : '';

    // O que cada gatilho por mensagem pode fazer, pelo estado da conversa:
    // - sem estado: qualquer agente de entrada do número ("qualquer mensagem" ou palavra-chave);
    // - parada pelo ATENDENTE (ai_paused_by preenchido): nada automático reabre, só Iniciar no chat;
    // - parada pelo próprio agente (resultado/limite): só palavra-chave (gatilho explícito) reabre;
    // - agente EXTERNO ativo (n8n via API): palavra-chave assume a conversa (a API passa a receber 409);
    // - pausada/aguardando aprovação (nativa) e externo pausado (atendente na conversa): pula.
    const stopped = conv.ai_status === 'stopped';
    const externalActive = !conv.ai_agent_id && conv.ai_status === 'active';
    const keywordsOnly = stopped || externalActive;
    if (stopped && conv.ai_paused_by) {
      return { status: 'skipped', reason: 'conversa parada pelo atendente' };
    }
    if (conv.ai_agent_id && !stopped) {
      if (conv.ai_status && conv.ai_status !== 'active') {
        return await skip(`conversa ${conv.ai_status}`, conv.ai_agent_id);
      }
      agent = await loadAgent(admin, organizationId, conv.ai_agent_id);
      if (!agent) return await skip('agente não encontrado', conv.ai_agent_id);
      if (!agent.enabled) return await skip('agente desligado', agent.id);
      if (!conv.ai_status) {
        await admin
          .from('wa_conversations')
          .update({ ai_status: 'active', ai_status_changed_at: new Date().toISOString() })
          .eq('id', conversationId)
          .eq('organization_id', organizationId);
      }
    } else if (!conv.ai_status || stopped || externalActive) {
      if (!conv.connection_id) return await skip('conversa sem número');
      // Agentes de entrada do número, filtrados pelo gatilho por mensagem (triggers.inbound)
      const { data: candidatesRaw } = await admin
        .from('wa_ai_agents')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('enabled', true)
        .contains('connection_ids', [conv.connection_id])
        .order('created_at', { ascending: true });
      const candidates = ((candidatesRaw ?? []) as Record<string, unknown>[]).map(normalizeAgentRow);
      // Sem candidato (gatilho 'none' ou palavra-chave sem correspondência): pula sem registrar execução,
      // senão cada mensagem do número viraria uma linha no histórico
      if (candidates.length === 0) return { status: 'skipped', reason: 'nenhum agente para este número' };
      const candidate = pickInboundAgent(candidates, text, { keywordsOnly });
      if (!candidate) {
        const reason = stopped
          ? 'conversa parada: sem palavra-chave'
          : externalActive
            ? 'agente externo: sem palavra-chave'
            : 'sem agente para esta mensagem';
        return { status: 'skipped', reason };
      }

      if (candidate.only_new_conversations) {
        const at = (msgRow as { created_at?: string } | null)?.created_at ?? new Date().toISOString();
        const { count } = await admin
          .from('wa_messages')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('conversation_id', conversationId)
          .eq('direction', 'out')
          .lt('created_at', at);
        if ((count ?? 0) > 0) return await skip('conversa antiga', candidate.id);
      }

      const now = new Date().toISOString();
      await admin
        .from('wa_conversations')
        .update({
          ai_agent_id: candidate.id,
          ai_status: 'active',
          ai_status_changed_at: now,
          ai_state: {},
          ai_approval: null,
          ai_resume_at: null,
          ai_paused_by: null,
        })
        .eq('id', conversationId)
        .eq('organization_id', organizationId);
      agent = candidate;
      ctx = await loadConversationContext(admin, organizationId, conversationId);
      events.push({ type: 'started', at: now });
      const results = await dispatchAgentEvent(admin, { agent, event: 'started', ctx });
      if (results.length > 0) events.push({ type: 'webhook', at: now, event: 'started', results });
    } else {
      // agente externo (API pública) pausado: o atendente está na conversa
      return { status: 'skipped', reason: 'agente externo pausado' };
    }

    if (!agent) return await skip('sem agente');

    // Limite por conversa: acima de RATE_MAX_RUNS execuções na janela, a mensagem é ignorada
    // (sem webhook, sem invocação e sem registro, senão o registro alimentaria a contagem)
    if (await inboundRateLimited(admin, organizationId, conversationId)) {
      console.warn(`[wa-agents] conversa ${conversationId}: acima de ${RATE_MAX_RUNS} execuções em ${RATE_WINDOW_MINUTES} min`);
      return { status: 'skipped', reason: 'limite de execuções por conversa' };
    }

    // Evento de mensagem recebida
    await dispatchAgentEvent(admin, { agent, event: 'message_received', ctx, extra: { message_id: messageId, text } });

    return await runAgentOnConversation({
      organizationId,
      conversationId,
      trigger: 'inbound',
      agentId: agent.id,
      triggerMessageId: messageId,
    });
  } catch (e) {
    const msg = errorMessage(e);
    console.error('[wa-agents] mensagem recebida falhou:', msg);
    const runId = await logRun(admin, {
      organization_id: organizationId,
      conversation_id: conversationId,
      trigger: 'inbound',
      status: 'error',
      reason: msg,
      error: msg,
      events,
    });
    return { status: 'error', reason: msg, runId };
  }
}

// ---------------------------------------------------------------------------
// Pausas vencidas (chamado pelo /api/wa-agents/tick)
// ---------------------------------------------------------------------------
export async function resumeDueConversations(
  admin: SupabaseClient,
  opts: { limit?: number; deadlineMs?: number } = {}
): Promise<{ resumed: number; results: RunResult[] }> {
  const limit = opts.limit ?? 50;
  const results: RunResult[] = [];
  let resumed = 0;
  try {
    const now = new Date().toISOString();
    const { data } = await admin
      .from('wa_conversations')
      .select('id, organization_id, ai_agent_id')
      .eq('ai_status', 'paused')
      .not('ai_resume_at', 'is', null)
      .lte('ai_resume_at', now)
      .not('ai_agent_id', 'is', null)
      .order('ai_resume_at', { ascending: true })
      .limit(limit);

    const betaByOrg = new Map<string, boolean>();
    for (const c of (data ?? []) as Array<{ id: string; organization_id: string; ai_agent_id: string }>) {
      // Orçamento de tempo do tick: o que sobrar fica para o próximo
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
      try {
        // Só orgs com a beta ligada: nas demais nada muda (nem estado, nem webhook). A pausa
        // perde o relógio para o cron parar de acordar por ela.
        let beta = betaByOrg.get(c.organization_id);
        if (beta === undefined) {
          beta = await isWaAgentsBetaEnabled(admin, c.organization_id);
          betaByOrg.set(c.organization_id, beta);
        }
        if (!beta) {
          await admin
            .from('wa_conversations')
            .update({ ai_resume_at: null })
            .eq('id', c.id)
            .eq('organization_id', c.organization_id)
            .eq('ai_status', 'paused');
          continue;
        }
        const { data: upd } = await admin
          .from('wa_conversations')
          .update({ ai_status: 'active', ai_resume_at: null, ai_paused_by: null, ai_status_changed_at: now })
          .eq('id', c.id)
          .eq('organization_id', c.organization_id)
          .eq('ai_status', 'paused')
          .select('id')
          .maybeSingle();
        if (!upd) continue;
        resumed++;
        try {
          const agent = await loadAgent(admin, c.organization_id, c.ai_agent_id);
          if (agent) {
            const ctx = await loadConversationContext(admin, c.organization_id, c.id);
            await dispatchAgentEvent(admin, { agent, event: 'resumed', ctx, extra: { by: 'timer' } });
          }
        } catch (e) {
          console.error('[wa-agents] webhook de retomada falhou:', errorMessage(e));
        }
        results.push(
          await runAgentOnConversation({
            organizationId: c.organization_id,
            conversationId: c.id,
            trigger: 'resume',
            skipBuffer: true,
          })
        );
      } catch (e) {
        console.error('[wa-agents] retomada falhou:', errorMessage(e));
      }
    }
  } catch (e) {
    console.error('[wa-agents] busca de pausas vencidas falhou:', errorMessage(e));
  }
  return { resumed, results };
}
