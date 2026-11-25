import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai-usage/budget', () => ({ createUsageContext: async () => ({ organizationId: 'org', scope: 'knowledge' }) }));
vi.mock('./model', async importOriginal => ({ ...await importOriginal<typeof import('./model')>(), getOrganizationApiKey: async () => null }));
vi.mock('./storage', () => ({ getAgentFileInfo: async () => ({ size: 64, mime: 'text/markdown' }) }));

import { processDocument } from './knowledge';
import { LEARNED_CHUNK_IDX_BASE } from './learnedAnswers';

function fakeDb() {
  const inserted: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const doc = {
    id: 'doc-1', organization_id: 'org', agent_id: 'agent-1', name: 'Guia.md', title: 'Guia', description: null, tags: [],
    mime: 'text/markdown', size_bytes: 64, storage_path: 'org/agents/agent-1/docs/x_Guia.md', status: 'ready', error: null,
    chunk_count: 1, created_at: '2026-11-25T10:00:00Z', updated_at: new Date().toISOString(),
  };
  const from = (table: string) => {
    let action = 'select';
    const query: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'neq', 'order', 'gt']) query[name] = () => query;
    query.update = (patch: Record<string, unknown>) => {
      action = 'update';
      updates.push(patch);
      return query;
    };
    query.delete = () => {
      action = 'delete';
      return query;
    };
    query.insert = async (rows: Array<Record<string, unknown>>) => {
      inserted.push(...rows);
      return { error: null };
    };
    query.maybeSingle = async () => ({ data: table === 'wa_ai_agent_documents' ? doc : null, error: null });
    query.then = (resolve: (value: unknown) => unknown) => resolve(
      table === 'wa_ai_agent_knowledge_gaps' && action === 'select'
        ? { data: [{ id: 'gap-1', question: 'Qual o hotel?', answer: 'Hotel Mar.' }], error: null }
        : { data: action === 'select' ? [] : null, error: null }
    );
    return query;
  };
  const storage = { from: () => ({ download: async () => ({ data: new Blob(['# Guia\n\nAtendemos de segunda a sexta.']), error: null }) }) };
  return { db: { from, storage } as unknown as SupabaseClient, inserted, updates };
}

describe('processDocument com respostas aprendidas', () => {
  it('reprocessar mantém as respostas aprendidas como trechos extras do documento', async () => {
    const { db, inserted, updates } = fakeDb();
    expect(await processDocument(db, { organizationId: 'org', documentId: 'doc-1' })).toEqual({ ok: true, chunkCount: 2, embedded: false });
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ document_id: 'doc-1', idx: 0, embedding: null });
    expect(String(inserted[0].content)).toContain('Atendemos de segunda a sexta.');
    expect(inserted[0]).not.toHaveProperty('gap_id');
    expect(inserted[1]).toMatchObject({
      document_id: 'doc-1', idx: LEARNED_CHUNK_IDX_BASE, content: 'Pergunta: Qual o hotel?\nResposta: Hotel Mar.', gap_id: 'gap-1',
    });
    expect(updates.at(-1)).toMatchObject({ status: 'ready', chunk_count: 2 });
  });
});
