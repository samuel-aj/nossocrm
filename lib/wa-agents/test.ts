/**
 * Teste de um agente no painel: mesma montagem de prompt e ferramentas, com
 * contexto fictício, sem enviar nada e sem executar ações.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMessage } from 'ai';
import { buildSystemPrompt, type ConversationContext } from './context';
import { generateAgentReply, NO_REPLY_TOKEN } from './engine';
import { errorMessage } from './errors';
import { resolveAgentModel } from './model';
import { logRun } from './runs';
import { splitLines } from './split';
import type { AgentRow } from './types';

export type TestMessage = { role: 'user' | 'assistant'; text: string };

export type TestAgentReplyResult = { text: string; lines: string[]; toolCalls: unknown[]; usage: unknown };

const TEST_PHONE = '+5500000000000';
const TEST_CONVERSATION_ID = '00000000-0000-0000-0000-000000000000';

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
      ai_state: { dados: input.state ?? {} },
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
  const { data: orgRow } = await admin
    .from('organizations')
    .select('name')
    .eq('id', input.organizationId)
    .maybeSingle();
  const ctx = buildTestContext({
    organizationId: input.organizationId,
    organizationName: (orgRow as { name?: string } | null)?.name ?? '',
    agent: input.agent,
    state: input.state,
  });

  const resolved = await resolveAgentModel(admin, input.organizationId, input.agent);
  const system = buildSystemPrompt({ agent: input.agent, ctx });
  const messages = toModelMessages(input.messages);
  const lastUser = [...input.messages].reverse().find(m => m.role === 'user')?.text ?? null;

  try {
    const gen = await generateAgentReply({ model: resolved.model, agent: input.agent, system, messages });
    const lines = gen.text && gen.text !== NO_REPLY_TOKEN ? splitLines(gen.text) : [];
    await logRun(admin, {
      organization_id: input.organizationId,
      agent_id: input.agent.id,
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
    return { text: gen.text, lines, toolCalls: gen.toolCalls, usage: gen.usage };
  } catch (e) {
    const msg = errorMessage(e);
    await logRun(admin, {
      organization_id: input.organizationId,
      agent_id: input.agent.id,
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
