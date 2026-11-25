import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { isMissingGapsSchema, loadLearnedAnswers, reopenGapsForDocument } from './learnedAnswers';

type Result = { data: unknown; error: { message: string; code?: string } | null };

function db(result: Result) {
  const calls: unknown[][] = [];
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'update']) {
    query[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return query;
    };
  }
  query.then = (resolve: (value: Result) => unknown) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('respostas aprendidas', () => {
  it('lê só as respostas incluídas do documento, no formato do trecho', async () => {
    const { client, calls } = db({
      data: [{ id: 'g1', question: 'Qual o hotel?', answer: 'Hotel Mar.' }, { id: 'g2', question: 'Sem resposta', answer: ' ' }],
      error: null,
    });
    expect(await loadLearnedAnswers(client, 'org', 'doc')).toEqual([{ gapId: 'g1', content: 'Pergunta: Qual o hotel?\nResposta: Hotel Mar.' }]);
    expect(calls).toContainEqual(['eq', 'organization_id', 'org']);
    expect(calls).toContainEqual(['eq', 'document_id', 'doc']);
    expect(calls).toContainEqual(['eq', 'status', 'included']);
  });

  it('antes da migração não quebra o processamento nem a exclusão', async () => {
    const missing = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.wa_ai_agent_knowledge_gaps' in the schema cache" } };
    expect(await loadLearnedAnswers(db(missing).client, 'org', 'doc')).toEqual([]);
    expect(await reopenGapsForDocument(db(missing).client, 'org', 'doc')).toBe(0);
    expect(isMissingGapsSchema({ code: '42703', message: 'column gap_id does not exist' })).toBe(true);
    expect(isMissingGapsSchema({ message: 'timeout' })).toBe(false);
    await expect(loadLearnedAnswers(db({ data: null, error: { message: 'timeout' } }).client, 'org', 'doc')).rejects.toThrow('timeout');
  });

  it('devolve para Abertas as respostas do documento excluído, guardando o texto', async () => {
    const { client, calls } = db({ data: [{ id: 'g1' }, { id: 'g2' }], error: null });
    expect(await reopenGapsForDocument(client, 'org', 'doc')).toBe(2);
    const update = calls.find(call => call[0] === 'update')![1] as Record<string, unknown>;
    expect(update).toMatchObject({ status: 'open', document_id: null });
    expect(update).not.toHaveProperty('answer');
    expect(calls).toContainEqual(['eq', 'status', 'included']);
  });
});
