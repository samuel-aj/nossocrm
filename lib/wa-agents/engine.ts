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
  tool,
  type LanguageModel,
  type ModelMessage,
  type StopCondition,
} from 'ai';
import { z } from 'zod';
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
import { resolveAgentModel, supportsTemperature } from './model';
import { logRun } from './runs';
import { splitLines } from './split';
import { pickInboundAgent } from './triggers';
import type {
  AgentEvent,
  AgentRow,
  AgentRunEvent,
  BotRunRow,
  ConversationAiState,
  ConversationApproval,
  CustomAction,
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

export const NO_REPLY_TOKEN = '[SEM_RESPOSTA]';
const LOCK_BASE_SECONDS = 90;
const LOCK_RETRY_MS = 2_000;
const LOCK_WAIT_MAX_MS = 60_000;
const MAX_HANDOFF_DEPTH = 3;
/** Passos do modelo por resposta: texto + salvar_dados + executar_acao + encerrar_atendimento cabem com folga */
const MAX_STEPS = 5;

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Duração da trava por conversa: geração + envio das linhas (até 8) + webhooks (por evento e das ações). */
export function lockSecondsFor(
  agent: Pick<AgentRow, 'line_delay_ms' | 'webhooks' | 'outcomes' | 'custom_actions'>
): number {
  const activeWebhooks = agent.webhooks.filter(w => w.active !== false).length;
  const actionWebhooks = [...(agent.outcomes ?? []), ...(agent.custom_actions ?? [])].reduce(
    (n, item) => n + (item.actions ?? []).filter(a => a.type === 'webhook').length,
    0
  );
  return LOCK_BASE_SECONDS + Math.ceil((8 * agent.line_delay_ms) / 1000) + 25 * (activeWebhooks + actionWebhooks);
}

// ---------------------------------------------------------------------------
// Ferramentas do modelo
// ---------------------------------------------------------------------------
export function buildAgentTools(agent: AgentRow) {
  const keys = agent.outcomes.map(o => o.key).filter(Boolean);
  const resultadoSchema = keys.length > 0 ? z.enum(keys) : z.string();
  const tools = {
    encerrar_atendimento: tool({
      description:
        'Encerra o pré-atendimento. Chame UMA única vez, na mesma resposta e depois de escrever a mensagem final ao cliente. Informe o resultado (uma das chaves configuradas) e um resumo objetivo do caso.',
      inputSchema: z.object({
        resultado: resultadoSchema.describe('Chave do resultado do atendimento'),
        resumo: z.string().describe('Resumo objetivo do caso: quem, o quê, quando, onde, provas, urgência'),
      }),
      execute: async args => args,
    }),
    salvar_dados: tool({
      description:
        'Salva dados descobertos sobre o atendimento (nome completo, cidade, tipo de caso, datas, documentos, urgência). Os dados são mesclados aos já salvos.',
      inputSchema: z.object({ dados: z.record(z.string(), z.any()) }),
      execute: async () => ({ ok: true }),
    }),
  };

  // Ações durante a conversa: só quando o agente tem alguma configurada
  const actionKeys = (agent.custom_actions ?? []).map(a => a.key).filter(Boolean);
  if (actionKeys.length === 0) return tools;
  const acaoSchema = z.enum(actionKeys);
  return {
    ...tools,
    executar_acao: tool({
      description:
        'Executa uma ação configurada no momento em que a situação descrita acontece na conversa (uma vez por ocorrência). Nas ações marcadas como finais no prompt, escreva a mensagem final ao cliente antes de chamar; as demais não encerram o atendimento.',
      inputSchema: z.object({
        acao: acaoSchema.describe('Chave da ação'),
        detalhes: z.string().describe('O que o cliente disse ou o contexto que motivou a ação, em uma ou duas frases'),
      }),
      execute: async args => ({ ok: true, acao: args.acao }),
    }),
  };
}

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

export type GeneratedReply = {
  text: string;
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
    tools: buildAgentTools(input.agent),
    // Depois de encerrar_atendimento não há passo extra: o texto sobrando iria para o lead
    stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('encerrar_atendimento'), hasTransitionAction],
  });

  const toolCalls: CollectedToolCall[] = [];
  const texts: string[] = [];
  for (const step of result.steps) {
    const t = (step.text ?? '').trim();
    if (t) texts.push(t);
    for (const tc of step.toolCalls) {
      const tr = step.toolResults.find(r => r.toolCallId === tc.toolCallId);
      toolCalls.push({ tool: tc.toolName, input: tc.input, output: tr?.output });
    }
  }
  // O texto final pode ter vindo no passo anterior ao da ferramenta: junta todos
  const text = (texts.join('\n') || result.text || '').trim();
  const u = result.totalUsage;
  const usage = {
    inputTokens: u?.inputTokens ?? null,
    outputTokens: u?.outputTokens ?? null,
    totalTokens: u?.totalTokens ?? null,
  };
  return { text, toolCalls, usage, finishReason: String(result.finishReason ?? '') };
}

/** Dados salvos via salvar_dados (mesclados na ordem das chamadas). */
export function mergeSavedData(toolCalls: CollectedToolCall[]): Record<string, unknown> | null {
  let merged: Record<string, unknown> | null = null;
  for (const tc of toolCalls) {
    if (tc.tool !== 'salvar_dados') continue;
    const dados = (tc.input as { dados?: unknown } | null)?.dados;
    if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
      merged = { ...(merged ?? {}), ...(dados as Record<string, unknown>) };
    }
  }
  return merged;
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

    // 5. Modelo, prompt e histórico
    const resolved = await resolveAgentModel(admin, organizationId, agent);
    modelId = resolved.modelId;
    // Instrução de apresentação só no primeiro contato pelo pipeline (não nas rodadas seguintes nem após passagem)
    const system = buildSystemPrompt({ agent, ctx, firstContact: input.trigger === 'deal' });
    const messages = await buildHistoryMessages(admin, ctx, agent.history_limit);
    if (input.forceReply && (messages.length === 0 || messages[messages.length - 1].role === 'assistant')) {
      messages.push({ role: 'user', content: '(o sistema pediu que você inicie/continue o atendimento agora)' });
    }

    // 6. Geração
    const gen = await generateAgentReply({ model: resolved.model, agent, system, messages });
    toolCalls.push(...gen.toolCalls);
    usage = gen.usage;
    const text = gen.text;
    outputText = text || null;

    // 7. Envio linha a linha
    let lines: string[] = [];
    if (text && text !== NO_REPLY_TOKEN) {
      lines = splitLines(text);
      await sendLines(admin, ctx, agent, lines, { renewLock: renew });
    }

    // 8. Estado da conversa
    const lastIn = pending.length > 0 ? pending[pending.length - 1] : await getLastMessage(admin, ctx, 'in');
    const saved = mergeSavedData(gen.toolCalls);
    const state: ConversationAiState = { ...((conv.ai_state ?? {}) as ConversationAiState) };
    if (saved) state.dados = { ...(state.dados ?? {}), ...saved };
    await updateConversation(admin, ctx, {
      ai_last_processed_at: lastIn?.created_at ?? new Date().toISOString(),
      ai_state: state,
    });
    ctx.conversation.ai_state = state;

    // 9. Eventos e esteira
    if (lines.length > 0) await emit('reply_sent', { text, lines });
    for (const tc of gen.toolCalls) await emit('tool_used', { tool: tc.tool, input: tc.input });

    // Mudança de estado pedida pelas ações (aprovação, passagem, parada): aplicada uma única vez
    // no fim. O resultado do encerramento prevalece sobre uma ação durante a conversa.
    let transition: { acts: OutcomeActionsResult; summary: string; reason: string; extra: Record<string, unknown> } | null =
      null;
    const requestsTransition = (acts: OutcomeActionsResult) =>
      !!(acts.approvalAgentId || acts.handoffAgentId || acts.stopped);

    // 9a. Ações durante a conversa (executar_acao): executam sem encerrar o atendimento.
    // A mesma chave repetida na mesma resposta executa uma vez só.
    const executedKeys = new Set<string>();
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
      if (executedKeys.has(custom.key)) {
        pushEvent('custom_action_repeated', { acao: custom.key, detalhes });
        continue;
      }
      executedKeys.add(custom.key);
      const acts = await executeCustomAction(admin, {
        agent,
        ctx,
        action: custom,
        details: detalhes,
        runEvents: events,
        renewLock: renew,
      });
      await emit('custom_action', { acao: custom.key, label: custom.label, detalhes });
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

    if (conv.ai_agent_id) {
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
    } else if (!conv.ai_status) {
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
      const candidate = pickInboundAgent(candidates, text);
      if (!candidate) return { status: 'skipped', reason: 'sem agente para esta mensagem' };

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
      // ai_status preenchido sem agente nativo: agente externo (API pública)
      return { status: 'skipped', reason: 'agente externo' };
    }

    if (!agent) return await skip('sem agente');

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

    for (const c of (data ?? []) as Array<{ id: string; organization_id: string; ai_agent_id: string }>) {
      // Orçamento de tempo do tick: o que sobrar fica para o próximo
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
      try {
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
