/** Full orchestration with fake DB/model/WhatsApp; no external effects. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRow } from './types';
import type { ConversationContext } from './context';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({
  generate: vi.fn(), send: vi.fn(), action: vi.fn(), outcome: vi.fn(), events: vi.fn(), log: vi.fn(),
  budget: vi.fn(), block: vi.fn(), reserve: vi.fn(), dispatch: vi.fn(), settle: vi.fn(), policyEnabled: false,
  ctx: null as ConversationContext | null, agent: null as AgentRow | null,
  db: null as unknown as SupabaseClient,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai-usage/budget', () => ({
  checkConversationBudget: h.budget, blockConversationBudget: h.block,
  reserveUsage: h.reserve, dispatchUsage: h.dispatch, settleUsage: h.settle,
  createUsageContext: async (admin: SupabaseClient, input: Record<string, unknown>) => ({ admin, ...input, accountId: 'account', policyEnabled: h.policyEnabled }),
}));
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), generateText: h.generate }));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => h.db }));
vi.mock('@/lib/supabase/actorClient', () => ({ withActor: (db: unknown) => db }));
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ sendText: h.send }) }));
vi.mock('@/lib/whatsapp/service', () => ({ recordOutboundMessage: async (_db: unknown, input: { text: string }) => ({ body: input.text }), replicateOutboundToSiblings: async () => {} }));
vi.mock('./context', async original => ({
  ...await original<typeof import('./context')>(),
  loadConversationContext: async () => structuredClone(h.ctx), loadAgent: async () => h.agent,
  buildSystemPrompt: () => 'Converse com o cliente.',
  buildHistoryMessages: async () => [{ role: 'user', content: 'Sim' }], loadLastInboundProviderId: async () => null,
}));
vi.mock('./model', async original => ({ ...await original<typeof import('./model')>(), resolveAgentModel: async () => ({ model: {}, modelId: 'fake' }) }));
vi.mock('./beta', () => ({ isAiAgentsApproved: async () => true }));
vi.mock('./autoLead', () => ({ ensureAutoLead: async () => {} }));
vi.mock('./resources', () => ({ loadAgentResources: async () => ({ documents: [], media: [], helpers: [] }) }));
vi.mock('./actions', () => ({ executeCustomAction: h.action, executeOutcomeActions: h.outcome }));
vi.mock('./webhooks', () => ({ dispatchAgentEvent: h.events }));
vi.mock('./runs', () => ({ logRun: h.log }));

import { handleInboundMessage, resumeDueConversations, runAgentOnConversation } from './engine';
import { AiUsageError, failUsage } from '@/lib/ai-usage/context';
import { meteredOperation } from '@/lib/ai-usage/meteredModel';
import { normalizeAgentRow } from './context';
import { buildTestContext, testAgentReply } from './test';

const org = '11111111-1111-4111-8111-111111111111';
const at = '2026-10-01T12:00:00.000Z';
const incoming = { id: 'message', organization_id: org, conversation_id: 'conv', direction: 'in', source: 'inbound', created_at: at, body: 'Sim' };
function fakeDb() {
  return {
    rpc: async (name: string) => {
      if (name === 'wa_ai_claim_lock') { h.ctx!.conversation.ai_lock_until = new Date(Date.now() + 90_000).toISOString(); return { data: true }; }
      return { data: 0 };
    },
    from: (table: string) => {
      let rows = table === 'wa_conversations' ? [h.ctx!.conversation as unknown as Record<string, unknown>] : table === 'wa_messages' ? [incoming as Record<string, unknown>] : [];
      let patch: Record<string, unknown> | undefined;
      let single = false;
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        eq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return q; },
        gt: () => q, lte: () => q, not: () => q, order: () => q, limit: () => q,
        maybeSingle: () => { single = true; return q; },
        then: (resolve: (r: unknown) => unknown) => {
          if (patch) rows.forEach(row => Object.assign(row, patch));
          return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null }));
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}
const call = { toolName: 'executar_acao', toolCallId: 'action', input: { acao: 'registrar', detalhes: 'Contato confirmou.' } };
function draft(text: string, withAction = true) {
  return { steps: [{ text, toolCalls: withAction ? [call] : [], toolResults: withAction ? [{ toolCallId: 'action', output: { ok: true } }] : [] }], text, totalUsage: {}, finishReason: 'stop' };
}
beforeEach(() => {
  vi.clearAllMocks(); h.generate.mockReset();
  h.policyEnabled = false;
  h.budget.mockReset().mockResolvedValue({ blocked_at: null, policy: { enabled: false } }); h.block.mockResolvedValue(undefined);
  h.reserve.mockResolvedValue({ allowed: true, replay: false, attempt_id: 'attempt' });
  h.dispatch.mockResolvedValue(true); h.settle.mockResolvedValue(undefined);
  h.agent = normalizeAgentRow({ id: 'agent', organization_id: org, name: 'Triagem', model: 'gpt-4.1', connection_ids: ['conn'], buffer_seconds: 0, typing: { enabled: false }, custom_actions: [{ key: 'registrar', label: 'Registrar', description: 'Confirmação', actions: [] }] });
  h.ctx = buildTestContext({ organizationId: org, organizationName: 'Teste', agent: h.agent });
  h.ctx.conversation.id = 'conv'; h.ctx.conversation.connection_id = 'conn';
  h.ctx.connection = { id: 'conn', organization_id: org, provider: 'evolution', status: 'connected', phone_number: '+5500000000000' } as ConversationContext['connection'];
  h.db = fakeDb();
  h.send.mockResolvedValue({ ok: true, providerMessageId: 'fake' });
  h.action.mockResolvedValue({ events: [], changed: false });
  h.outcome.mockResolvedValue({ events: [] });
  h.events.mockResolvedValue([]); h.log.mockResolvedValue('run');
});
const run = () => runAgentOnConversation({ organizationId: org, conversationId: 'conv', trigger: 'inbound', skipBuffer: true });

describe('validação no envio real e no simulador', () => {
  it('nova mensagem não reabre orçamento nem emite webhook em conversa bloqueada', async () => {
    h.budget.mockResolvedValue({ blocked_at: at });
    const result = await handleInboundMessage({ organizationId: org, conversationId: 'conv', messageId: 'message' });
    expect(result.status).toBe('skipped');
    expect(h.generate).not.toHaveBeenCalled(); expect(h.events).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it('o cron remove o relógio sem retomar uma conversa bloqueada', async () => {
    h.ctx!.conversation.ai_status = 'paused'; h.ctx!.conversation.ai_resume_at = at;
    h.budget.mockResolvedValue({ blocked_at: at });
    expect((await resumeDueConversations(h.db)).resumed).toBe(0);
    expect(h.ctx!.conversation).toMatchObject({ ai_status: 'paused', ai_resume_at: null });
    expect(h.generate).not.toHaveBeenCalled(); expect(h.events).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it('não chama modelo, ações, envios ou webhooks quando o saldo está bloqueado', async () => {
    h.budget.mockResolvedValue({ blocked_at: at });
    expect((await run()).status).toBe('skipped');
    expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    expect(h.action).not.toHaveBeenCalled(); expect(h.events).not.toHaveBeenCalled();
  });
  it('interrompe antes do modelo quando não consegue conferir o saldo', async () => {
    h.budget.mockRejectedValue(new Error('ledger unavailable'));
    expect((await run()).status).toBe('error');
    expect(h.generate).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled(); expect(h.events).not.toHaveBeenCalled();
  });
  it('um erro de consumo capturado por ferramenta impede qualquer envio posterior', async () => {
    h.policyEnabled = true;
    h.budget.mockResolvedValue({ blocked_at: null, policy: { enabled: true } });
    h.generate.mockImplementation(async () => {
      failUsage(new AiUsageError('AI_USAGE_EXHAUSTED'));
      return draft('Texto que não pode sair');
    });
    expect((await run()).status).toBe('error');
    expect(h.send).not.toHaveBeenCalled(); expect(h.action).not.toHaveBeenCalled();
    expect(h.events).not.toHaveBeenCalled(); expect(h.block).toHaveBeenCalledTimes(1);
  });
  it.each(['timeout', '429 rate limit'])('medição-only interrompe %s sem criar trava manual e preserva a reserva desconhecida', async reason => {
    const provider = vi.fn(async () => { throw new Error(reason); });
    h.generate.mockImplementationOnce(async () => meteredOperation({ operation: 'reply', provider: 'openai', model: 'gpt-4.1-mini', bound: 1000, execute: provider, usage: () => null }));
    expect((await run()).status).toBe('error');
    expect(h.settle).toHaveBeenCalledWith(expect.anything(), 'attempt', expect.objectContaining({ status: 'unknown' }));
    expect(h.block).not.toHaveBeenCalled();
    expect(h.ctx!.conversation.ai_status).toBe('active');
    expect(h.send).not.toHaveBeenCalled(); expect(h.events).not.toHaveBeenCalled(); expect(h.action).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(1);
    // After the provider recovers, a later turn can proceed without a manual grant.
    h.generate.mockResolvedValueOnce(draft('Resposta simulada após recuperação.', false));
    expect((await run()).status).toBe('ok');
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('aplica a política habilitada depois de criar o contexto de medição', async () => {
    h.generate.mockImplementation(async () => {
      h.budget.mockResolvedValue({ blocked_at: null, policy: { enabled: true } });
      throw failUsage(new Error('timeout'));
    });
    expect((await run()).status).toBe('error');
    expect(h.block).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled(); expect(h.events).not.toHaveBeenCalled();
  });
  it('não cria trava nova se a política foi desligada depois de criar o contexto protegido', async () => {
    h.policyEnabled = true;
    h.budget.mockResolvedValue({ blocked_at: null, policy: { enabled: true } });
    h.generate.mockImplementation(async () => {
      h.budget.mockResolvedValue({ blocked_at: null, policy: { enabled: false } });
      throw failUsage(new Error('timeout'));
    });
    expect((await run()).status).toBe('error');
    expect(h.block).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled(); expect(h.events).not.toHaveBeenCalled();
  });
  it('bloqueia tudo, pausa e registra erro sem enviar nem executar ações se a recuperação falhar', async () => {
    h.generate.mockResolvedValueOnce(draft('Olá!\n{"dados":{"nome":"Teste"}}'));
    h.generate.mockResolvedValueOnce({ output: { replacements: [{ id: 0, text: '{"dados":{}}' }] } });
    const r = await run();
    expect(r.status).toBe('error');
    expect(h.ctx!.conversation.ai_status).toBe('paused');
    expect(h.ctx!.conversation.ai_resume_at).toBeNull();
    expect(h.ctx!.conversation.ai_lock_until).toBeNull();
    expect(h.send).not.toHaveBeenCalled(); expect(h.action).not.toHaveBeenCalled(); expect(h.outcome).not.toHaveBeenCalled();
    expect(h.events.mock.calls.map(c => c[1].event)).toEqual(['error']);
    expect(h.events.mock.calls[0][1]).toMatchObject({ ctx: { conversation: { ai_status: 'paused' } }, extra: { paused: true } });
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls[0][1]).toMatchObject({ status: 'error', output_text: null, events: expect.arrayContaining([expect.objectContaining({ type: 'output_checked', status: 'blocked' })]) });
  });
  it('não sobrescreve uma intervenção humana feita durante a geração', async () => {
    h.generate.mockResolvedValueOnce(draft('{"dados":{}}'));
    h.generate.mockImplementationOnce(async () => {
      Object.assign(h.ctx!.conversation, { ai_status: 'stopped', ai_paused_by: 'user', ai_lock_until: null });
      throw new Error('invalid output');
    });
    const r = await run();
    expect(r.status).toBe('error');
    expect(h.ctx!.conversation).toMatchObject({ ai_status: 'stopped', ai_paused_by: 'user' });
    expect(h.events.mock.calls[0][1].extra).toMatchObject({ code: 'AI_OUTPUT_BLOCKED', paused: false });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.action).not.toHaveBeenCalled();
  });
  it('após recuperação envia apenas o texto corrigido e aplica a ação uma vez', async () => {
    h.generate.mockResolvedValueOnce(draft('{"dados":{"nome":"Teste"}}'));
    h.generate.mockResolvedValueOnce({ output: { replacements: [{ id: 0, text: 'Qual o valor?' }] } });
    const r = await run();
    expect(r.status).toBe('ok');
    expect(h.send.mock.calls.map(c => c[0].text)).toEqual(['Qual o valor?']);
    expect(h.action).toHaveBeenCalledTimes(1);
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(h.generate.mock.calls[1][0].tools).toBeUndefined();
    expect(h.ctx!.conversation.ai_last_processed_at).toBe(at);
    expect(h.log.mock.calls[0][1].output_text).toBe('Qual o valor?');
  });
  it('envia uma cópia de cada linha e mantém a conversa ativa', async () => {
    h.generate.mockResolvedValueOnce(draft('Preciso confirmar uma informação.\nPosso continuar?\nPreciso confirmar uma informação.\nPosso continuar?', false));
    expect((await run()).status).toBe('ok');
    expect(h.send.mock.calls.map(c => c[0].text)).toEqual(['Preciso confirmar uma informação.', 'Posso continuar?']);
    expect(h.ctx!.conversation.ai_status).toBe('active');
  });
  it('simulador usa a mesma barreira e grava uma única falha, sem envio nem ação', async () => {
    h.generate.mockResolvedValueOnce(draft('{"dados":{}}'));
    h.generate.mockRejectedValueOnce(new Error('timeout'));
    await expect(testAgentReply(h.db, { organizationId: org, agent: h.agent!, messages: [{ role: 'user', text: 'Sim' }] })).rejects.toThrow('bloqueada');
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls[0][1]).toMatchObject({ status: 'error', events: [expect.objectContaining({ type: 'output_checked', status: 'blocked' })] });
    expect(h.send).not.toHaveBeenCalled(); expect(h.action).not.toHaveBeenCalled();
  });
});
