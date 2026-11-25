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
import { LEARNED_DOCUMENT_TITLE } from './knowledgeGapsShared';

type Row = Record<string, unknown>;
const ORG = 'org';
const AGENT = 'agent';
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
        const list = (Array.isArray(payload) ? payload : [payload as Row]).map(row => ({ id: `${table}-${nextId++}`, ...row }));
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
  const storage = {
    from: () => ({
      upload: async (path: string, body: unknown, options: unknown) => {
        uploads.push({ path, body, options });
        return { data: { path }, error: null };
      },
    }),
  };
  return { db: { from, storage } as unknown as SupabaseClient, tables, uploads };
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
  it('incluir grava o trecho no documento escolhido e marca a dúvida como incluída', async () => {
    const { db, tables } = memoryDb({
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
    expect(tables.wa_ai_agent_chunks.find(row => row.gap_id === 'gap-1')).toMatchObject({
      document_id: DOC, idx: LEARNED_CHUNK_IDX_BASE, embedding: [0.1, 0.2], embedding_model: MODEL,
      content: 'Pergunta: Qual é o hotel do pacote do Rio?\nResposta: Hotel Mar Azul, em Copacabana.',
    });
    expect(tables.wa_ai_agent_documents[0].chunk_count).toBe(2);
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
    const { db, tables, uploads } = memoryDb({
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
    expect(tables.wa_ai_agent_chunks).toEqual([expect.objectContaining({ document_id: doc.id, gap_id: 'gap-1', embedding: null })]);
  });

  it('editar troca o trecho e atualiza a contagem dos dois documentos', async () => {
    const { db, tables } = memoryDb({
      wa_ai_agent_documents: [documentRow(DOC, { chunk_count: 2 }), documentRow(DOC2, { chunk_count: 1 })],
      wa_ai_agent_knowledge_gaps: [gapRow('gap-1', { status: 'included', answer: 'Antiga', document_id: DOC, reviewed_at: '2026-11-25T10:00:00Z' })],
      wa_ai_agent_chunks: [chunk('c1', DOC, null), chunk('c2', DOC, 'gap-1', 'Pergunta: x\nResposta: Antiga'), chunk('c3', DOC2, null)],
    });
    await applyKnowledgeGapAction(db, {
      ...base, gapId: 'gap-1', action: { action: 'edit', question: 'Qual o hotel?', answer: 'Nova', document_id: DOC2 },
    });
    expect(tables.wa_ai_agent_chunks.filter(row => row.gap_id === 'gap-1')).toEqual([
      expect.objectContaining({ document_id: DOC2, content: 'Pergunta: Qual o hotel?\nResposta: Nova' }),
    ]);
    expect(tables.wa_ai_agent_documents.find(row => row.id === DOC)!.chunk_count).toBe(1);
    expect(tables.wa_ai_agent_documents.find(row => row.id === DOC2)!.chunk_count).toBe(2);
  });
});

describe('outras ações', () => {
  it('tirar da base apaga o trecho e manda a dúvida para Ignoradas', async () => {
    const { db, tables } = memoryDb({
      wa_ai_agent_documents: [documentRow(DOC, { chunk_count: 2 })],
      wa_ai_agent_knowledge_gaps: [gapRow('gap-1', { status: 'included', answer: 'Antiga', document_id: DOC })],
      wa_ai_agent_chunks: [chunk('c1', DOC, null), chunk('c2', DOC, 'gap-1')],
    });
    const gap = await applyKnowledgeGapAction(db, { ...base, gapId: 'gap-1', action: { action: 'remove' } });
    expect(gap).toMatchObject({ status: 'ignored', document_id: null, answer: 'Antiga' });
    expect(tables.wa_ai_agent_chunks.map(row => row.id)).toEqual(['c1']);
    expect(tables.wa_ai_agent_documents[0].chunk_count).toBe(1);
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
