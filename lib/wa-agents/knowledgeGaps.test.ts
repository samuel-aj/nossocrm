import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ embed: vi.fn(), profile: vi.fn() }));
vi.mock('./knowledge', async importOriginal => ({
  ...await importOriginal<typeof import('./knowledge')>(),
  embedTexts: h.embed,
  agentEmbeddingProfile: h.profile,
}));

import { createGapReporter, recordKnowledgeGap } from './knowledgeGaps';
import { MASKED_PERSONAL_DATA } from './knowledgeGapsShared';

const ORG = 'org-1';
const AGENT = 'agent-1';
const vector = Array.from({ length: 1536 }, () => 0.01);
type RpcResult = { data: unknown; error?: { message: string } | null };

function rpcDb(responses: Record<string, RpcResult>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      return { error: null, ...(responses[fn] ?? { data: null }) };
    }),
  };
  return { db: db as unknown as SupabaseClient, calls, record: () => calls.filter(([fn]) => fn === 'wa_ai_record_knowledge_gap') };
}

beforeEach(() => {
  h.embed.mockReset();
  h.profile.mockReset();
  h.profile.mockResolvedValue({ model: 'openai:text-embedding-3-small', chunks: 10 });
});

describe('recordKnowledgeGap', () => {
  it('mascara dados pessoais, agrupa pelo embedding e sugere o documento mais parecido', async () => {
    h.embed.mockResolvedValue({ embeddings: [vector], model: 'openai:text-embedding-3-small', provider: 'openai' });
    const { db, record } = rpcDb({
      wa_ai_match_chunks: { data: [{ document_id: 'doc-1', similarity: 0.6 }] },
      wa_ai_record_knowledge_gap: { data: [{ gap_id: 'gap-1', created: true }] },
    });
    const question = `Qual o prazo do auxílio? Meu CPF é ${MASKED_PERSONAL_DATA}`;
    const result = await recordKnowledgeGap(db, {
      organizationId: ORG,
      agentId: AGENT,
      source: { kind: 'conversation', conversationId: 'conv-1' },
      pergunta: '  Qual o prazo do auxílio? Meu CPF é 123.456.789-09  ',
      o_que_falta: 'A base fala do pedido, mas não do prazo.',
      resposta_sugerida: 'O pedido é feito no INSS.',
    });
    expect(result).toEqual({ ok: true, id: 'gap-1', created: true });
    expect(h.embed).toHaveBeenCalledWith(db, ORG, [question], expect.objectContaining({ prefer: 'openai:text-embedding-3-small' }));
    expect(record()[0][1]).toEqual({
      p_org: ORG,
      p_agent: AGENT,
      p_question: question,
      p_question_key: 'qual o prazo do auxilio meu cpf e dado removido',
      p_embedding: vector,
      p_model: 'openai:text-embedding-3-small',
      p_threshold: 0.85,
      p_context: 'A base fala do pedido, mas não do prazo.',
      p_suggested_answer: 'O pedido é feito no INSS.',
      p_suggested_document: 'doc-1',
      p_source_key: 'conv-1',
      p_conversation: 'conv-1',
      p_test: false,
      p_open_limit: 200,
    });
  });

  it('sem chave de embedding agrupa só pelo texto e sugere pela busca por texto', async () => {
    h.embed.mockResolvedValue(null);
    const { db, record } = rpcDb({
      wa_ai_search_chunks: { data: [{ document_id: 'doc-2', rank: 0.1 }] },
      wa_ai_record_knowledge_gap: { data: [{ gap_id: 'gap-2', created: false }] },
    });
    const result = await recordKnowledgeGap(db, {
      organizationId: ORG, agentId: AGENT, source: { kind: 'test', sessionId: 's1' }, pergunta: 'Atende aos sábados?',
    });
    expect(result).toEqual({ ok: true, id: 'gap-2', created: false });
    expect(record()[0][1]).toMatchObject({
      p_embedding: null, p_model: null, p_threshold: null, p_suggested_document: 'doc-2',
      p_source_key: 'teste:s1', p_conversation: null, p_test: true, p_context: null, p_suggested_answer: null,
    });
  });

  it('falha no embedding não impede o registro', async () => {
    h.embed.mockRejectedValue(new Error('provedor fora do ar'));
    const { db, record } = rpcDb({ wa_ai_record_knowledge_gap: { data: [{ gap_id: 'gap-3', created: true }] } });
    const result = await recordKnowledgeGap(db, { organizationId: ORG, agentId: AGENT, source: { kind: 'test' }, pergunta: 'Tem estacionamento?' });
    expect(result).toEqual({ ok: true, id: 'gap-3', created: true });
    expect(record()[0][1]).toMatchObject({ p_embedding: null, p_source_key: 'teste' });
  });

  it('pergunta vazia, limite de abertas e erro do banco viram resultado sem lançar', async () => {
    h.embed.mockResolvedValue(null);
    const empty = rpcDb({});
    expect(await recordKnowledgeGap(empty.db, { organizationId: ORG, agentId: AGENT, source: { kind: 'test' }, pergunta: ' ?! ' })).toEqual({ ok: false, reason: 'empty' });
    expect(empty.calls).toEqual([]);

    const full = rpcDb({ wa_ai_record_knowledge_gap: { data: [] } });
    expect(await recordKnowledgeGap(full.db, { organizationId: ORG, agentId: AGENT, source: { kind: 'test' }, pergunta: 'Qual o prazo?' })).toEqual({ ok: false, reason: 'limit' });

    const broken = rpcDb({ wa_ai_record_knowledge_gap: { data: null, error: { message: 'tabela ausente' } } });
    expect(await recordKnowledgeGap(broken.db, { organizationId: ORG, agentId: AGENT, source: { kind: 'test' }, pergunta: 'Qual o prazo?' }))
      .toEqual({ ok: false, reason: 'error', error: 'tabela ausente' });
  });
});

describe('createGapReporter', () => {
  it('registra cada dúvida uma vez por resposta, respeita o teto e avisa o motor', async () => {
    h.embed.mockResolvedValue(null);
    const { db, record } = rpcDb({ wa_ai_record_knowledge_gap: { data: [{ gap_id: 'gap-1', created: true }] } });
    const events: Array<[string, Record<string, unknown> | undefined]> = [];
    const report = createGapReporter(db, {
      organizationId: ORG, agentId: AGENT, source: { kind: 'conversation', conversationId: 'conv-1' },
      onEvent: (type, extra) => events.push([type, extra]),
    });
    expect(await report({ pergunta: 'Qual o prazo?' })).toEqual({ ok: true, registrada: true });
    expect(await report({ pergunta: 'qual o PRAZO' })).toEqual({ ok: true, registrada: true });
    expect(await report({ pergunta: 'Atende aos sábados?' })).toEqual({ ok: true, registrada: true });
    expect(await report({ pergunta: 'Tem estacionamento?' })).toEqual({ ok: false, erro: 'Limite de 2 dúvidas registradas nesta resposta atingido.' });
    expect(record()).toHaveLength(2);
    expect(events).toEqual([
      ['knowledge_gap_recorded', { gap_id: 'gap-1', nova: true }],
      ['knowledge_gap_recorded', { gap_id: 'gap-1', nova: true }],
    ]);
  });

  it('falha na gravação vira resposta curta para o modelo e evento de erro', async () => {
    h.embed.mockResolvedValue(null);
    const { db } = rpcDb({ wa_ai_record_knowledge_gap: { data: null, error: { message: 'tabela ausente' } } });
    const events: string[] = [];
    const report = createGapReporter(db, { organizationId: ORG, agentId: AGENT, source: { kind: 'test' }, onEvent: type => events.push(type) });
    expect(await report({ pergunta: 'Qual o prazo?' })).toEqual({ ok: false, erro: 'Não foi possível registrar a dúvida agora.' });
    expect(events).toEqual(['knowledge_gap_failed']);
  });
});
