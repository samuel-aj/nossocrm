/** Full orchestration with fake DB/model/WhatsApp; no external effects. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRow } from './types';
import type { ConversationContext } from './context';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({
  generate: vi.fn(), send: vi.fn(), action: vi.fn(), outcome: vi.fn(), events: vi.fn(), log: vi.fn(),
  ctx: null as ConversationContext | null, agent: null as AgentRow | null,
  db: null as unknown as SupabaseClient,
}));
vi.mock('server-only', () => ({}));
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

import { runAgentOnConversation } from './engine';
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
        gt: () => q, order: () => q, limit: () => q,
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
