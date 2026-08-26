/**
 * Teste de um agente no painel: mesma montagem de prompt e ferramentas, com
 * contexto fictício, sem enviar nada e sem executar ações. As ferramentas
 * consultar_documentos, consultar_agente e calcular são reais; enviar_midia é
 * simulada (devolve "mídia X enviada (simulado)").
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMessage } from 'ai';
import { buildSystemPrompt, type ConversationContext } from './context';
import {
  generateAgentReply,
  MAX_HELPER_CALLS_PER_RUN,
  MAX_KNOWLEDGE_CALLS_PER_RUN,
  NO_REPLY_TOKEN,
  type ReplySegment,
} from './engine';
import { errorMessage } from './errors';
import { consultHelperAgent } from './helpers';
import { searchKnowledge } from './knowledge';
import { resolveAgentModel } from './model';
import { loadAgentResources } from './resources';
import { logRun } from './runs';
import { sanitizeSavedData } from './savedData';
import { splitLines } from './split';
import { normalizeKeyword } from './text';
import type { AgentToolRuntime } from './tools';
import type { AgentRow, KnowledgeHit } from './types';

export type TestMessage = { role: 'user' | 'assistant'; text: string };

export type TestAgentReplyResult = {
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
    const text = (m.text ?? '').trim();
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

export async function testAgentReply(
  admin: SupabaseClient,
  input: { organizationId: string; agent: AgentRow; messages: TestMessage[]; state?: Record<string, unknown> }
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

  const resolved = await resolveAgentModel(admin, organizationId, agent);
  const resources = await loadAgentResources(admin, organizationId, agent);
  const lastUser = [...input.messages].reverse().find(m => m.role === 'user')?.text ?? null;

  // Mesma injeção automática da conversa real: trechos para a última mensagem do lead
  let knowledge: KnowledgeHit[] = [];
  if (resources.documents.length > 0 && lastUser) {
    knowledge = await searchKnowledge(admin, { organizationId, agent, query: lastUser, limit: AUTO_KNOWLEDGE_LIMIT });
  }
  const system = buildSystemPrompt({ agent, ctx, resources, knowledge });
  const messages = toModelMessages(input.messages);

  // Mesmos tetos por resposta da conversa real (consultas à base e a auxiliares)
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
      return searchKnowledge(admin, { organizationId, agent, query: q, limit: TOOL_KNOWLEDGE_LIMIT });
    },
    // Simulado: nada é enviado (mas cada mídia só uma vez por resposta, como na conversa real)
    sendMedia: async media => {
      const key = normalizeKeyword(media.name);
      if (mediaQueued.has(key)) return { ok: false, error: `mídia "${media.name}" já enviada neste atendimento; não envie de novo` };
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

  try {
    const gen = await generateAgentReply({ model: resolved.model, agent, system, messages, runtime });
    const lines = gen.text && gen.text !== NO_REPLY_TOKEN ? splitLines(gen.text) : [];
    const media = gen.segments.filter(s => s.kind === 'media').map(s => (s.kind === 'media' ? s.name : ''));
    await logRun(admin, {
      organization_id: organizationId,
      agent_id: agent.id,
      conversation_id: null,
      trigger: 'test',
      status: 'ok',
      input_text: lastUser,
      output_text: gen.text || null,
      tool_calls: gen.toolCalls,
      usage: gen.usage,
      model: resolved.modelId,
      duration_ms: Date.now() - startedAt,
    });
    return { text: gen.text, lines, toolCalls: gen.toolCalls, usage: gen.usage, segments: gen.segments, media };
  } catch (e) {
    const msg = errorMessage(e);
    await logRun(admin, {
      organization_id: organizationId,
      agent_id: agent.id,
      conversation_id: null,
      trigger: 'test',
      status: 'error',
      input_text: lastUser,
      model: resolved.modelId,
      duration_ms: Date.now() - startedAt,
      error: msg,
    });
    throw e;
  }
}
