import { resolveReturnTime } from './scheduledReturnTime';
/**
 * Teste de um agente no painel: mesma montagem de prompt e ferramentas, com
 * contexto fictício, sem enviar nada e sem executar ações. As ferramentas
 * consultar_documentos, consultar_agente e calcular são reais; enviar_midia é
 * simulada (devolve "mídia X enviada (simulado)").
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMessage } from 'ai';
import { createUsageContext } from '@/lib/ai-usage/budget';
import { assertUsageHealthy, runWithUsageContext } from '@/lib/ai-usage/context';
import { buildSystemPrompt, type ConversationContext } from './context';
import {
  generateAgentReply,
  MAX_HELPER_CALLS_PER_RUN,
  MAX_KNOWLEDGE_CALLS_PER_RUN,
  NO_REPLY_TOKEN,
  type ReplySegment,
  type GeneratedReply,
} from './engine';
import { errorMessage } from './errors';
import { agentHistoryText } from './replyOutput';
import { voiceDelivery, VOICE_NOTICE } from './voiceDelivery';
import { consultHelperAgent } from './helpers';
import { searchKnowledge } from './knowledge';
import { resolveAgentModel } from './model';
import { loadAgentResources } from './resources';
import { logRun } from './runs';
import { sanitizeSavedData } from './savedData';
import { splitLines } from './split';
import { normalizeKeyword } from './text';
import { simulatedMediaNames } from './mediaDelivery';
import { reserveTestMedia, settleTestMedia, testDeliveredMediaNames, type TestMediaReceipt } from './testMediaDelivery';
import type { AgentToolRuntime } from './tools';
import type { AgentRow, KnowledgeHit } from './types';

export type TestMessage = { role: 'user' | 'assistant'; text: string; audio?: boolean; contractReviewKey?: string; media?: string[] };

/**
 * Agente salvo + a configuração que está na TELA do editor (rascunho), para o
 * admin testar antes de salvar. Só as chaves realmente enviadas são aplicadas.
 *
 * Regras que o rascunho nunca quebra:
 * - `id` e `organization_id` continuam sendo os do banco;
 * - chave da API vazia ou mascarada mantém a salva (o formulário nunca recebe a
 *   chave de volta); chave nova digitada agora vale no teste, e null cai na
 *   chave da organização.
 */
export function agentWithDraft(
  saved: AgentRow,
  draft: Partial<AgentRow> | null | undefined,
  opts: { presentKeys?: string[]; apiKey?: string | null } = {}
): AgentRow {
  if (!draft) return saved;
  const keys = opts.presentKeys ?? Object.keys(draft);
  const merged: AgentRow = { ...saved };
  for (const key of keys) {
    if (key === 'id' || key === 'organization_id' || key === 'api_key') continue;
    if (!Object.prototype.hasOwnProperty.call(draft, key)) continue;
    (merged as Record<string, unknown>)[key] = (draft as Record<string, unknown>)[key];
  }
  if (opts.apiKey !== undefined) merged.api_key = opts.apiKey;
  return merged;
}

export type TestAgentReplyResult = {
  voiceLines?: number[];
  contractReviewKey?: string;
  text: string;
  lines: string[];
  toolCalls: unknown[];
  usage: unknown;
  /** Texto e mídias (simuladas) na ordem em que o agente produziu */
  segments: ReplySegment[];
  /** Nomes das mídias que o agente pediu para enviar (simulado) */
  media: string[];
};

const TEST_PHONE = '+5500000000000';
const TEST_CONVERSATION_ID = '00000000-0000-0000-0000-000000000000';
const AUTO_KNOWLEDGE_LIMIT = 3;
const TOOL_KNOWLEDGE_LIMIT = 5;

export function buildTestContext(input: {
  organizationId: string;
  organizationName: string;
  agent: AgentRow;
  state?: Record<string, unknown>;
}): ConversationContext {
  const now = new Date().toISOString();
  return {
    conversation: {
      id: TEST_CONVERSATION_ID,
      organization_id: input.organizationId,
      connection_id: null,
      contact_id: null,
      wa_phone: TEST_PHONE,
      wa_name: 'Lead de teste',
      last_message_at: null,
      assigned_owner_id: null,
      deal_id: null,
      ai_status: 'active',
      ai_status_changed_at: now,
      ai_paused_by: null,
      ai_agent_id: input.agent.id,
      ai_resume_at: null,
      ai_state: { dados: sanitizeSavedData(input.state ?? {}) },
      ai_last_processed_at: null,
      ai_lock_until: null,
      ai_approval: null,
      created_at: now,
      updated_at: now,
    },
    connection: null,
    contact: { id: TEST_CONVERSATION_ID, name: 'Lead de teste', phone: TEST_PHONE, email: null },
    deal: null,
    org: { id: input.organizationId, name: input.organizationName },
  };
}

/** Converte as mensagens do painel em mensagens do modelo (alternância garantida). */
export function toModelMessages(messages: TestMessage[]): ModelMessage[] {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    const rawText = (m.text ?? '').trim();
    const text = m.role === 'assistant' ? agentHistoryText(rawText) : rawText;
    if (!text) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${text}`;
    else out.push({ role, content: text });
  }
  if (out.length === 0) out.push({ role: 'user', content: '(o sistema pediu que você inicie o atendimento agora)' });
  else if (out[0].role === 'assistant') out.unshift({ role: 'user', content: '(início da conversa)' });
  if (out[out.length - 1].role === 'assistant') {
    out.push({ role: 'user', content: '(o sistema pediu que você continue o atendimento agora)' });
  }
  return out.map(m => ({ role: m.role, content: m.content }) as ModelMessage);
}

type TestInput = { organizationId: string; agent: AgentRow; messages: TestMessage[]; state?: Record<string, unknown>; signatureEvent?: 'signed'; contractState?: 'invited'|'signed'; session?: { id: string; userId: string } };
export async function testAgentReply(
  admin: SupabaseClient,
  input: TestInput
): Promise<TestAgentReplyResult> {
  const usage = await createUsageContext(admin, { organizationId: input.organizationId, agentId: input.agent.id, scope: 'test' });
  return runWithUsageContext(usage, () => testAgentReplyWithUsage(admin, input));
}

async function testAgentReplyWithUsage(
  admin: SupabaseClient,
  input: TestInput
): Promise<TestAgentReplyResult> {
  const startedAt = Date.now();
  const { organizationId, agent } = input;
  const { data: orgRow } = await admin
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .maybeSingle();
  const ctx = buildTestContext({
    organizationId,
    organizationName: (orgRow as { name?: string } | null)?.name ?? '',
    agent,
    state: input.state,
  });
  const sentMedia = simulatedMediaNames(input.messages);
  ctx.conversation.ai_state!.midias_enviadas = [...sentMedia];

  if (input.signatureEvent === 'signed' && agent.tools.zapsign_template_token) {
    const { composeSignedReply } = await import('@/lib/zapsign/agentSignedReply');
    const text = await composeSignedReply(admin, agent, ctx, input.messages.map(m=>({role:m.role,content:m.text})), true);
    return { text, lines:[text], toolCalls:[], usage:null, segments:[{kind:'text',text}], media:[] };
  }
  const resolved = await resolveAgentModel(admin, organizationId, agent);
  const resources = await loadAgentResources(admin, organizationId, agent);
  // Historical receipts have no timestamp; repeatable media use only the server cooldown.
  for (const media of resources.media) if (media.send_once_per_conversation === false) sentMedia.delete(normalizeKeyword(media.name));
  const mediaScope = input.session ? { organizationId, userId: input.session.userId, agentId: agent.id, sessionId: input.session.id } : null;
  if (mediaScope) {
    for (const name of await testDeliveredMediaNames(admin, mediaScope, resources.media)) sentMedia.add(name);
  }
  ctx.conversation.ai_state!.midias_enviadas = [...sentMedia];
  const sessionEvents = input.session ? [{ type: 'test_session', at: new Date().toISOString(), session_id: input.session.id, user_id: input.session.userId }] : [];
  const lastUser = [...input.messages].reverse().find(m => m.role === 'user')?.text ?? null;

  // Mesma injeção automática da conversa real: trechos para a última mensagem do lead
  let knowledge: KnowledgeHit[] = [];
  if (resources.documents.length > 0 && lastUser) {
    knowledge = await searchKnowledge(admin, { organizationId, agent, query: lastUser, limit: AUTO_KNOWLEDGE_LIMIT });
  }
  const system = buildSystemPrompt({ agent, ctx, resources, knowledge }) +
    (input.contractState === 'signed' ? '\nZapSign simulada: cliente assinou e recebeu o acompanhamento.' :
      input.contractState === 'invited' ? '\nZapSign simulada: o link foi entregue. Aguardando assinatura.' : '');
  const messages = toModelMessages(input.messages);

  // Mesmos tetos por resposta da conversa real (consultas à base e a auxiliares)
  const mediaQueued = new Set<string>();
  const mediaReceipts = new Map<string, TestMediaReceipt>();
  let helperCalls = 0;
  let knowledgeCalls = 0;
  // Local to this simulation: tool calls can inspect/reschedule/cancel without reserving a real run.
  let simulatedReturn: { id: string; scheduled_for: string; scheduled_timezone: string; bot_id: string } | null = null;
  let contractReviewKey: string | undefined;
  const runtime: AgentToolRuntime = {
    ...(agent.tools?.zapsign_template_token ? {
      contract: async (args: Parameters<NonNullable<AgentToolRuntime['contract']>>[0]) => {
        if (input.contractState) return { ok: true, existente: true, simulado: true, estado: input.contractState === 'signed' ? 'assinado' : 'aguardando assinatura' };
        const { simulateAgentContract } = await import('@/lib/zapsign/agentSimulation');
        return simulateAgentContract(admin, organizationId, agent.tools.zapsign_template_token!, input.messages, args, agent.tools.zapsign_variables,
          key => { contractReviewKey = key; });
      },
    } : {}),
    scheduledReturn: {
      inspect: async () => ({ now: new Date().toISOString(), timezone: 'America/Sao_Paulo', pending: simulatedReturn, simulated: true }),
      schedule: async input => {
        const at = resolveReturnTime(input);
        simulatedReturn = { id: 'simulated-return', scheduled_for: at, scheduled_timezone: input.timezone, bot_id: agent.tools?.scheduled_return_bot_id ?? '' };
        return { ok: true, simulated: true, id: simulatedReturn.id, scheduledAt: at, timezone: input.timezone, local: input.local, calendarException: true };
      },
      cancel: async () => {
        const cancelled = simulatedReturn ? 1 : 0;
        simulatedReturn = null;
        return { ok: true, simulated: true, cancelled };
      },
    },
    documents: resources.documents,
    media: resources.media,
    helpers: resources.helpers,
    searchKnowledge: async q => {
      knowledgeCalls += 1;
      if (knowledgeCalls > MAX_KNOWLEDGE_CALLS_PER_RUN) {
        throw new Error(`Limite de ${MAX_KNOWLEDGE_CALLS_PER_RUN} consultas à base de conhecimento nesta resposta atingido: responda com o que já tem`);
      }
      return searchKnowledge(admin, { organizationId, agent, query: q, limit: TOOL_KNOWLEDGE_LIMIT });
    },
    // No real delivery: the server retains receipts even if an API client omits history.
    sendMedia: async media => {
      const key = normalizeKeyword(media.name);
      if (sentMedia.has(key) || mediaQueued.has(key)) return { ok: false, error: `mídia "${media.name}" já enviada neste atendimento; não envie de novo` };
      if (mediaScope) {
        const receipt = await reserveTestMedia(admin, mediaScope, media);
        if (!receipt) return { ok: false, error: `mídia "${media.name}" já enviada nesta simulação; não envie de novo` };
        mediaReceipts.set(key, receipt);
      }
      mediaQueued.add(key);
      return { ok: true, note: `mídia ${media.name} enviada (simulado)` };
    },
    consultHelper: async (helper, question) => {
      helperCalls += 1;
      if (helperCalls > MAX_HELPER_CALLS_PER_RUN) {
        return `Limite de ${MAX_HELPER_CALLS_PER_RUN} consultas a agentes auxiliares nesta resposta atingido: responda com o que já tem.`;
      }
      return consultHelperAgent(admin, { organizationId, helper, question, ctx, askedBy: agent });
    },
  };

  let generated: GeneratedReply | null = null;
  try {
    const gen = await generateAgentReply({ model: resolved.model, agent, system, messages, runtime });
    assertUsageHealthy();
    generated = gen;
    if (gen.outputSafety.status === 'blocked') throw new Error('Resposta da IA bloqueada por conter dados internos. Revise o roteiro e tente novamente.');
    const lastMessage = input.messages.at(-1);
    const mirror = !!agent.media_understanding?.reply_to_audio && lastMessage?.role === 'user' && !!lastMessage.audio;
    const accepted = new Set<string>();
    const visibleSegments = gen.segments.filter(segment => {
      if (segment.kind !== 'media') return true;
      const key = normalizeKeyword(segment.name);
      if (!mediaQueued.has(key) || accepted.has(key)) return false;
      accepted.add(key);
      return true;
    });
    const segments = voiceDelivery(visibleSegments, mirror);
    const lines: string[] = [];
    const voiceLines: number[] = [];
    let introduced = input.messages.some(m => m.role === 'assistant' && m.text.split('\n').includes(VOICE_NOTICE));
    for (const seg of segments) {
      if (seg.kind !== 'text' || !seg.text || seg.text === NO_REPLY_TOKEN) continue;
      if (seg.voice) {
        if (!introduced) { lines.push(VOICE_NOTICE); introduced = true; }
        voiceLines.push(lines.length);
        lines.push(seg.text);
      } else lines.push(...splitLines(seg.text));
    }
    const media = visibleSegments.filter(s => s.kind === 'media').map(s => (s.kind === 'media' ? s.name : ''));
    await settleTestMedia(admin, [...mediaReceipts].filter(([name]) => !accepted.has(name)).map(([, receipt]) => receipt), false);
    await settleTestMedia(admin, [...mediaReceipts].filter(([name]) => accepted.has(name)).map(([, receipt]) => receipt), true);
    await logRun(admin, {
      organization_id: organizationId,
      agent_id: agent.id,
      conversation_id: null,
      trigger: 'test',
      status: 'ok',
      events: [...sessionEvents, { type: 'output_checked', at: new Date().toISOString(), ...gen.outputSafety }],
      input_text: lastUser,
      output_text: gen.text || null,
      tool_calls: gen.toolCalls,
      usage: gen.usage,
      model: resolved.modelId,
      duration_ms: Date.now() - startedAt,
    });
    return { text: gen.text, lines, voiceLines, toolCalls: gen.toolCalls, usage: gen.usage, segments, media, contractReviewKey };
  } catch (e) {
    // A failed generation/safety check produced no visible simulation result.
    // Never touch another request's receipt, even when it used the same session.
    try { await settleTestMedia(admin, [...mediaReceipts.values()], false); }
    catch (cleanupError) { console.error('[wa-agents/test] media receipt cleanup', cleanupError); }
    const msg = errorMessage(e);
    await logRun(admin, {
      organization_id: organizationId,
      agent_id: agent.id,
      conversation_id: null,
      trigger: 'test',
      status: 'error',
      reason: generated?.outputSafety.status === 'blocked' ? 'Resposta bloqueada por conter dados internos; revisão necessária.' : null,
      events: [...sessionEvents, ...(generated ? [{ type: 'output_checked', at: new Date().toISOString(), ...generated.outputSafety }] : [])],
      tool_calls: generated?.toolCalls ?? [],
      usage: generated?.usage ?? null,
      input_text: lastUser,
      model: resolved.modelId,
      duration_ms: Date.now() - startedAt,
      error: msg,
    });
    throw e;
  }
}
