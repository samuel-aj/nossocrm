import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ embed: vi.fn(), profile: vi.fn(), process: vi.fn() }));
vi.mock('@/lib/ai-usage/budget', () => ({ createUsageContext: async () => ({ organizationId: 'org', scope: 'knowledge' }) }));
vi.mock('./knowledge', async importOriginal => ({
  ...await importOriginal<typeof import('./knowledge')>(),
  embedTexts: h.embed,
  agentEmbeddingProfile: h.profile,
  processDocument: h.process,
}));

import { applyKnowledgeGapAction, deleteKnowledgeGap, KnowledgeGapError, listKnowledgeGaps, openGapCountsByAgent } from './knowledgeGaps';
import { LEARNED_CHUNK_IDX_BASE } from './learnedAnswers';
import { AGENT_CHUNKS_MAX_PER_AGENT } from './types';
import { LEARNED_DOCUMENT_TITLE } from './knowledgeGapsShared';

type Row = Record<string, unknown>;
const ORG = 'org';
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = 'admin-user';
const DOC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DOC2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MODEL = 'openai:text-embedding-3-small';

/** Banco em memória com o subconjunto do supabase-js usado pelo módulo. */
function memoryDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
  const uploads: Array<{ path: string; body: unknown; options: unknown }> = [];
  let nextId = 1;
  const from = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let action: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | undefined;
    let head = false;
    let counting = false;
    let returning = false;
    const matches = (row: Row) => filters.every(([op, column, value]) => (op === 'eq' ? row[column] === value : row[column] !== value));
    const run = () => {
      const rows = (tables[table] ??= []);
      if (action === 'insert') {
        const inputs = Array.isArray(payload) ? payload : [payload as Row];
        if (inputs.some(input => input.id && rows.some(row => row.id === input.id))) {
          return { data: null, error: { code: '23505', message: 'ID já reservado' }, count: null };
        }
        const list = inputs.map(row => ({ id: table + '-' + nextId++, updated_at: new Date().toISOString(), ...row }));
        rows.push(...list);
        return { data: list.map(row => ({ ...row })), error: null, count: null };
      }
      const hit = rows.filter(matches);
      if (action === 'update') {
        hit.forEach(row => Object.assign(row, payload));
        return { data: returning ? hit.map(row => ({ ...row })) : null, error: null, count: null };
      }
      if (action === 'delete') {
        tables[table] = rows.filter(row => !hit.includes(row));
        return { data: null, error: null, count: null };
      }
      return { data: head ? null : hit.map(row => ({ ...row })), error: null, count: counting ? hit.length : null };
    };
    const query: Record<string, unknown> = {
      select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
        if (action === 'select') {
          head = !!options?.head;
          counting = !!options?.count;
        } else returning = true;
        return query;
      },
      insert: (value: Row | Row[]) => { action = 'insert'; payload = value; return query; },
      update: (value: Row) => { action = 'update'; payload = value; return query; },
      delete: () => { action = 'delete'; return query; },
      eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return query; },
      neq: (column: string, value: unknown) => { filters.push(['neq', column, value]); return query; },
      order: () => query,
      limit: () => query,
      maybeSingle: async () => { const result = run(); return { ...result, data: (result.data as Row[] | null)?.[0] ?? null }; },
      single: async () => {
        const result = run();
        const first = (result.data as Row[] | null)?.[0] ?? null;
        return { ...result, data: first, error: first ? null : { message: 'nenhuma linha' } };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return query;
  };
  const upload = vi.fn(async (path: string, body: unknown, options: unknown): Promise<{ error: { message: string } | null }> => {
    uploads.push({ path, body, options });
    return { error: null };
  });
  const storage = { from: () => ({ upload }) };
  const rpc = vi.fn((name: string, input: Row): { data: Row | null; error: { code: string; message: string } | null } => {
    if (name !== 'wa_ai_review_knowledge_gap') throw new Error('RPC inesperada: ' + name);
    const gap = tables.wa_ai_agent_knowledge_gaps.find(row => row.id === input.p_gap
      && row.organization_id === input.p_org && row.agent_id === input.p_agent);
    if (!gap) return { data: { code: 'NOT_FOUND' }, error: null };
    if (gap.updated_at !== input.p_expected_updated_at) return { data: { code: 'CONFLICT' }, error: null };
    Object.assign(gap, input.p_action === 'remove'
      ? { status: 'ignored', document_id: null }
      : { status: 'included', document_id: input.p_document, question: input.p_question, answer: input.p_answer, reviewed_by: input.p_user });
    gap.updated_at = '2026-11-27T10:00:00.123456+00:00';
    return { data: { gap: { ...gap } }, error: null };
  });
  return { db: { from, storage, rpc } as unknown as SupabaseClient, tables, uploads, upload, rpc };
}

function documentRow(id: string, overrides: Row = {}): Row {
  return {
    id, organization_id: ORG, agent_id: AGENT, name: `${id}.pdf`, title: null, description: null, tags: [], mime: 'application/pdf',
    size_bytes: 10, storage_path: `${ORG}/agents/${AGENT}/docs/x_${id}.pdf`, status: 'ready', error: null, chunk_count: 1,
    embedding_model: MODEL, created_at: '2026-11-20T10:00:00Z', updated_at: new Date().toISOString(), ...overrides,
  };
}

function gapRow(id: string, overrides: Row = {}): Row {
  return {
    id, organization_id: ORG, agent_id: AGENT, status: 'open', question: 'Qual o hotel do pacote?', question_key: 'qual o hotel do pacote',
    context: null, suggested_answer: 'Hotel 3 estrelas.', answer: null, document_id: null, suggested_document_id: DOC, occurrences: 2,
    test_only: false, last_conversation_id: null, first_seen_at: '2026-11-24T10:00:00Z', last_seen_at: '2026-11-25T10:00:00Z',
    reviewed_by: null, reviewed_at: null, created_at: '2026-11-24T10:00:00Z', updated_at: '2026-11-25T10:00:00Z', ...overrides,
  };
}

const chunk = (id: string, documentId: string, gapId: string | null, content = 'Trecho do arquivo'): Row => ({
  id, organization_id: ORG, agent_id: AGENT, document_id: documentId, idx: gapId ? LEARNED_CHUNK_IDX_BASE : 0, content, gap_id: gapId,
});

const base = { organizationId: ORG, agentId: AGENT, userId: ADMIN };

beforeEach(() => {
  h.embed.mockReset();
  h.process.mockReset();
  h.profile.mockReset();
  h.profile.mockResolvedValue({ model: MODEL, chunks: 10 });
  h.embed.mockResolvedValue({ embeddings: [[0.1, 0.2]], model: MODEL, provider: 'openai' });
});

describe('incluir e editar', () => {
  it('inclui no documento escolhido com o mesmo texto e modelo usados para calcular o embedding', async () => {
    const { db, tables, rpc } = memoryDb({
      wa_ai_agent_documents: [documentRow(DOC, { title: 'Pacotes' })],
      wa_ai_agent_knowledge_gaps: [gapRow('gap-1')],
      wa_ai_agent_chunks: [chunk('c1', DOC, null)],
    });
    const gap = await applyKnowledgeGapAction(db, {
      ...base, gapId: 'gap-1',
      action: { action: 'include', question: 'Qual é o hotel do pacote do Rio?', answer: 'Hotel Mar Azul, em Copacabana.', document_id: DOC },
    });
    expect(gap).toMatchObject({ status: 'included', question: 'Qual é o hotel do pacote do Rio?', answer: 'Hotel Mar Azul, em Copacabana.', document_id: DOC, reviewed_by: ADMIN });
    expect(h.embed).toHaveBeenCalledWith(
      db, ORG, ['Documento: Pacotes\nPergunta: Qual é o hotel do pacote do Rio?\nResposta: Hotel Mar Azul, em Copacabana.'],
      expect.objectContaining({ prefer: MODEL })
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith('wa_ai_review_knowledge_gap', {
      p_org: ORG, p_agent: AGENT, p_gap: 'gap-1', p_user: ADMIN, p_action: 'include',
      p_expected_updated_at: '2026-11-25T10:00:00Z', p_document: DOC,
      p_question: 'Qual é o hotel do pacote do Rio?', p_question_key: 'qual e o hotel do pacote do rio',
      p_answer: 'Hotel Mar Azul, em Copacabana.', p_embedding: [0.1, 0.2],
      p_model: MODEL, p_expected_document_model: MODEL, p_chunk_limit: AGENT_CHUNKS_MAX_PER_AGENT,
    });
    // Só a RPC pode trocar trechos ou recalcular a contagem.
    expect(tables.wa_ai_agent_chunks).toEqual([chunk('c1', DOC, null)]);
    expect(tables.wa_ai_agent_documents[0].chunk_count).toBe(1);
  });

  it('não inclui em documento em processamento', async () => {
    const { db, tables } = memoryDb({
      wa_ai_agent_documents: [documentRow(DOC, { status: 'processing' })],
      wa_ai_agent_knowledge_gaps: [gapRow('gap-1')],
      wa_ai_agent_chunks: [],
    });
    await expect(applyKnowledgeGapAction(db, {
      ...base, gapId: 'gap-1', action: { action: 'include', question: 'Qual o hotel?', answer: 'Mar Azul', document_id: DOC },
    })).rejects.toMatchObject({ code: 'DOCUMENT_NOT_READY', status: 409 });
    expect(tables.wa_ai_agent_chunks).toEqual([]);
    expect(tables.wa_ai_agent_knowledge_gaps[0].status).toBe('open');
  });

  it('cria o documento "Respostas aprendidas" quando escolhido e inclui a resposta nele', async () => {
    const { db, tables, uploads, rpc } = memoryDb({
      wa_ai_agent_documents: [],
      wa_ai_agent_knowledge_gaps: [gapRow('gap-1', { suggested_document_id: null })],
      wa_ai_agent_chunks: [],
    });
    h.process.mockImplementation(async (_db: unknown, input: { documentId: string }) => {
      const doc = tables.wa_ai_agent_documents.find(row => row.id === input.documentId)!;
      Object.assign(doc, { status: 'ready', chunk_count: 1, embedding_model: null });
      return { ok: true, chunkCount: 1, embedded: false };
    });
    const gap = await applyKnowledgeGapAction(db, {
      ...base, gapId: 'gap-1', action: { action: 'include', question: 'Atende aos sábados?', answer: 'Sim, das 8h às 12h.', create_document: true },
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(new RegExp(`^${ORG}/agents/${AGENT}/docs/[0-9a-f-]{36}_Respostas_aprendidas\\.md$`));
    const doc = tables.wa_ai_agent_documents[0];
    expect(doc).toMatchObject({ title: LEARNED_DOCUMENT_TITLE, mime: 'text/markdown', created_by: ADMIN });
    expect(gap.document_id).toBe(doc.id);
    expect(h.embed).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('wa_ai_review_knowledge_gap', expect.objectContaining({
      p_document: doc.id, p_embedding: null, p_model: null, p_expected_document_model: null,
    }));
  });

  it('duas inclusões simultâneas reservam e enviam um único arquivo', async () => {
    const { db, uploads, tables } = memoryDb({
      wa_ai_agent_documents: [], wa_ai_agent_knowledge_gaps: [gapRow('g1'), gapRow('g2')],
    });
    h.process.mockImplementation(async () => {
      Object.assign(tables.wa_ai_agent_documents[0], { status: 'ready', embedding_model: null });
      return { ok: true };
    });
    const include = (gapId: string) => applyKnowledgeGapAction(db, { ...base, gapId,
      action: { action: 'include', question: 'Qual o prazo?', answer: 'Uma semana', create_document: true } });
    const ids = ['g1', 'g2'];
    const results = await Promise.allSettled(ids.map(include));
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    for (const [i, result] of results.entries()) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'DOCUMENT_NOT_READY', status: 409 });
        await include(ids[i]);
      }
    }
    expect(tables.wa_ai_agent_documents).toHaveLength(1);
    expect(tables.wa_ai_agent_knowledge_gaps.map(row => row.document_id)).toEqual([AGENT, AGENT]);
    expect(uploads).toHaveLength(1);
    expect(h.process).toHaveBeenCalledTimes(1);
  });

  it('retoma uma reserva após confirmação perdida do upload usando o mesmo registro e caminho', async () => {
    const { db, tables, upload } = memoryDb({ wa_ai_agent_documents: [], wa_ai_agent_knowledge_gaps: [gapRow('g')] });
    upload.mockResolvedValueOnce({ error: { message: 'Confirmação indisponível' } });
    h.process.mockImplementation(async () => {
      Object.assign(tables.wa_ai_agent_documents[0], { status: 'ready', embedding_model: null });
      return { ok: true };
    });
    const include = () => applyKnowledgeGapAction(db, { ...base, gapId: 'g',
      action: { action: 'include', question: 'Qual o prazo?', answer: 'Uma semana', create_document: true } });
    await expect(include()).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    expect(tables.wa_ai_agent_documents[0].status).toBe('error');
    await expect(include()).resolves.toMatchObject({ document_id: AGENT });
    expect(tables.wa_ai_agent_documents).toHaveLength(1);
    expect(upload.mock.calls[0]).toEqual(upload.mock.calls[1]);
    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: true });
    expect(h.process).toHaveBeenCalledTimes(1);
  });

  it('recupera uma reserva cujo processo parou sem resposta', async () => {
    const path = `${ORG}/agents/${AGENT}/docs/${AGENT}_Respostas_aprendidas.md`;
    const { db, tables, uploads } = memoryDb({
      wa_ai_agent_documents: [documentRow(AGENT, { storage_path: path, title: LEARNED_DOCUMENT_TITLE, status: 'processing', updated_at: '2000-01-01T00:00:00Z' })],
      wa_ai_agent_knowledge_gaps: [gapRow('g')],
    });
    h.process.mockImplementation(async () => {
      Object.assign(tables.wa_ai_agent_documents[0], { status: 'ready', embedding_model: null });
      return { ok: true };
    });
    await expect(applyKnowledgeGapAction(db, { ...base, gapId: 'g',
      action: { action: 'include', question: 'Qual o prazo?', answer: 'Uma semana', create_document: true } })).resolves.toMatchObject({ document_id: AGENT });
    expect(tables.wa_ai_agent_documents).toHaveLength(1);
    expect(uploads[0].path).toBe(path);
  });

  it('reaproveita um documento pronto criado antes da reserva sem reescrever o arquivo', async () => {
    const { db, uploads } = memoryDb({
      wa_ai_agent_documents: [documentRow(DOC, { title: LEARNED_DOCUMENT_TITLE })],
      wa_ai_agent_knowledge_gaps: [gapRow('g')],
    });
    await expect(applyKnowledgeGapAction(db, { ...base, gapId: 'g',
      action: { action: 'include', question: 'Qual o prazo?', answer: 'Uma semana', create_document: true } })).resolves.toMatchObject({ document_id: DOC });
    expect(uploads).toHaveLength(0);
    expect(h.process).not.toHaveBeenCalled();
  });

  it('editar envia a mudança de documento inteira em uma única revisão', async () => {
    const { db, rpc } = memoryDb({
      wa_ai_agent_documents: [documentRow(DOC, { chunk_count: 2 }), documentRow(DOC2, { chunk_count: 1 })],
      wa_ai_agent_knowledge_gaps: [gapRow('gap-1', { status: 'included', answer: 'Antiga', document_id: DOC, reviewed_at: '2026-11-25T10:00:00Z' })],
      wa_ai_agent_chunks: [chunk('c1', DOC, null), chunk('c2', DOC, 'gap-1', 'Pergunta: x\nResposta: Antiga'), chunk('c3', DOC2, null)],
    });
    await applyKnowledgeGapAction(db, {
      ...base, gapId: 'gap-1', action: { action: 'edit', question: 'Qual o hotel?', answer: 'Nova', document_id: DOC2 },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('wa_ai_review_knowledge_gap', expect.objectContaining({
      p_action: 'edit', p_document: DOC2, p_question: 'Qual o hotel?', p_answer: 'Nova',
    }));
  });
});

describe('outras ações', () => {
  it('tirar da base solicita a remoção sem preparar embedding nem enviar outra resposta', async () => {
    const { db, rpc } = memoryDb({
      wa_ai_agent_documents: [documentRow(DOC, { chunk_count: 2 })],
      wa_ai_agent_knowledge_gaps: [gapRow('gap-1', { status: 'included', answer: 'Antiga', document_id: DOC })],
      wa_ai_agent_chunks: [chunk('c1', DOC, null), chunk('c2', DOC, 'gap-1')],
    });
    const gap = await applyKnowledgeGapAction(db, { ...base, gapId: 'gap-1', action: { action: 'remove' } });
    expect(gap).toMatchObject({ status: 'ignored', document_id: null, answer: 'Antiga' });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('wa_ai_review_knowledge_gap', {
      p_org: ORG, p_agent: AGENT, p_gap: 'gap-1', p_user: ADMIN, p_action: 'remove',
      p_expected_updated_at: '2026-11-25T10:00:00Z',
    });
    expect(h.embed).not.toHaveBeenCalled();
  });

  it('recusa transições inválidas e só exclui dúvida aberta ou ignorada', async () => {
    const { db, tables } = memoryDb({
      wa_ai_agent_knowledge_gaps: [gapRow('gap-1', { status: 'included', answer: 'x', document_id: DOC }), gapRow('gap-2')],
    });
    await expect(applyKnowledgeGapAction(db, { ...base, gapId: 'gap-1', action: { action: 'ignore' } })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    await expect(applyKnowledgeGapAction(db, { ...base, gapId: 'gap-2', action: { action: 'reopen' } })).rejects.toBeInstanceOf(KnowledgeGapError);
    await expect(deleteKnowledgeGap(db, { organizationId: ORG, agentId: AGENT, gapId: 'gap-1' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await deleteKnowledgeGap(db, { organizationId: ORG, agentId: AGENT, gapId: 'gap-2' });
    expect(tables.wa_ai_agent_knowledge_gaps.map(row => row.id)).toEqual(['gap-1']);
    await expect(applyKnowledgeGapAction(db, { ...base, gapId: 'outra', action: { action: 'ignore' } })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('ignorar e reabrir trocam o status', async () => {
    const { db } = memoryDb({ wa_ai_agent_knowledge_gaps: [gapRow('gap-1')] });
    expect(await applyKnowledgeGapAction(db, { ...base, gapId: 'gap-1', action: { action: 'ignore' } })).toMatchObject({ status: 'ignored' });
    expect(await applyKnowledgeGapAction(db, { ...base, gapId: 'gap-1', action: { action: 'reopen' } })).toMatchObject({ status: 'open' });
  });
});

describe('revisão concorrente e falhas da RPC', () => {
  const originalTimestamp = '2026-11-25T10:00:00.123456+00:00';
  const edit = { action: 'edit' as const, document_id: DOC, question: 'Qual o hotel?', answer: 'Nova resposta', expected_updated_at: originalTimestamp };
  function fixture() {
    return memoryDb({
      wa_ai_agent_documents: [documentRow(DOC)],
      wa_ai_agent_knowledge_gaps: [gapRow('g', { status: 'included', document_id: DOC, answer: 'Anterior', updated_at: originalTimestamp })],
      wa_ai_agent_chunks: [chunk('c', DOC, 'g')],
    });
  }

  it('duas edições leem a mesma versão e só uma é aceita pela RPC', async () => {
    const { db, rpc } = fixture();
    const edits = await Promise.allSettled(['Uma', 'Outra'].map(answer =>
      applyKnowledgeGapAction(db, { ...base, gapId: 'g', action: { ...edit, answer } })
    ));
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const [, args] of rpc.mock.calls) expect(args.p_expected_updated_at).toBe(originalTimestamp);
    expect(edits.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(edits.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT', status: 409 } });
  });

  it('rejeita um formulário obsoleto mesmo quando a diferença é de um microssegundo', async () => {
    const { db, rpc } = fixture();
    await expect(applyKnowledgeGapAction(db, {
      ...base, gapId: 'g', action: { ...edit, expected_updated_at: originalTimestamp.replace('123456','123455') },
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(rpc).not.toHaveBeenCalled();
    expect(h.embed).not.toHaveBeenCalled();
  });

  it('ignorar com uma versão antiga preserva a dúvida aberta', async () => {
    const { db, tables } = memoryDb({ wa_ai_agent_knowledge_gaps: [gapRow('g', { updated_at: originalTimestamp })] });
    await expect(applyKnowledgeGapAction(db, {
      ...base, gapId: 'g', action: { action: 'ignore', expected_updated_at: '2026-11-24T00:00:00Z' },
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(tables.wa_ai_agent_knowledge_gaps[0].status).toBe('open');
  });

  it.each([
    ['NOT_FOUND', 404], ['DOCUMENT_NOT_FOUND', 404], ['DOCUMENT_NOT_READY', 409], ['CHUNK_LIMIT', 400], ['CONFLICT', 409],
  ])('mapeia o resultado de domínio %s', async (code, status) => {
    const { db, rpc, tables } = fixture();
    rpc.mockReturnValueOnce({ data: { code }, error: null });
    await expect(applyKnowledgeGapAction(db, { ...base, gapId: 'g', action: edit })).rejects.toMatchObject({ code, status });
    expect(tables.wa_ai_agent_chunks).toEqual([chunk('c', DOC, 'g')]);
  });

  it('não divulga detalhes do banco nem efetua gravações compensatórias quando a RPC falha', async () => {
    const { db, rpc, tables } = fixture();
    rpc.mockReturnValueOnce({ data: null, error: { code: 'XX000', message: 'detalhe interno com dados do banco' } });
    await expect(applyKnowledgeGapAction(db, { ...base, gapId: 'g', action: edit })).rejects.toThrow('Não foi possível concluir a revisão da dúvida.');
    expect(tables.wa_ai_agent_chunks).toEqual([chunk('c', DOC, 'g')]);
    expect(tables.wa_ai_agent_knowledge_gaps[0].answer).toBe('Anterior');
  });

  it('não revê uma dúvida ou um documento de outro agente ou organização', async () => {
    const { db, rpc, tables } = fixture();
    for (const scope of [{ organizationId: 'outra' }, { agentId: 'outro' }]) {
      await expect(applyKnowledgeGapAction(db, { ...base, ...scope, gapId: 'g', action: edit })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    for (const scope of [{ organization_id: 'outra' }, { agent_id: 'outro' }]) {
      tables.wa_ai_agent_documents = [documentRow(DOC, scope)];
      await expect(applyKnowledgeGapAction(db, { ...base, gapId: 'g', action: edit })).rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(h.embed).not.toHaveBeenCalled();
  });

  it('se o provedor falha, mantém a versão anterior sem chamar a RPC', async () => {
    const { db, rpc } = fixture();
    h.embed.mockRejectedValueOnce(new Error('Falha transitória fictícia'));
    await expect(applyKnowledgeGapAction(db, { ...base, gapId: 'g', action: edit })).rejects.toMatchObject({ code: 'INDEX_FAILED', status: 502 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('lista e totais', () => {
  it('lista por status com os totais e as respostas por documento', async () => {
    const { db } = memoryDb({
      wa_ai_agent_knowledge_gaps: [
        gapRow('g1'), gapRow('g2', { status: 'ignored' }),
        gapRow('g3', { status: 'included', answer: 'a', document_id: DOC }),
        gapRow('g4', { status: 'included', answer: 'b', document_id: DOC }),
        gapRow('g5', { agent_id: 'outro' }),
      ],
    });
    const result = await listKnowledgeGaps(db, ORG, AGENT, 'open');
    expect(result.gaps.map(gap => gap.id)).toEqual(['g1']);
    expect(result.counts).toEqual({ open: 1, ignored: 1, included: 2 });
    expect(result.learned_by_document).toEqual({ [DOC]: 2 });
    expect(await openGapCountsByAgent(db, ORG)).toEqual({ [AGENT]: 1, outro: 1 });
  });
});
