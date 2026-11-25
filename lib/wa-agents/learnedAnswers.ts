/**
 * Respostas aprendidas: dúvidas incluídas num documento viram trechos extras
 * dele (wa_ai_agent_chunks.gap_id). O processamento do documento lê daqui para
 * manter esses trechos ao reprocessar, e a exclusão do documento devolve as
 * respostas para "Dúvidas sem resposta". SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { learnedChunkContent } from './knowledgeGapsShared';

/** idx dos trechos de respostas aprendidas: depois dos trechos do arquivo. */
export const LEARNED_CHUNK_IDX_BASE = 100_000;

export type LearnedAnswer = { gapId: string; content: string };

type DbError = { message: string; code?: string } | null;

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

/** Tabela ou coluna das dúvidas ainda não criada (migração 20261125120000 não aplicada). */
export function isMissingGapsSchema(error: DbError): boolean {
  if (!error) return false;
  if (error.code && MISSING_SCHEMA_CODES.has(error.code)) return true;
  return /(wa_ai_agent_knowledge_gaps|gap_id)/.test(error.message) && /(does not exist|schema cache)/i.test(error.message);
}

/** Respostas incluídas num documento, no formato do trecho. */
export async function loadLearnedAnswers(admin: SupabaseClient, organizationId: string, documentId: string): Promise<LearnedAnswer[]> {
  const { data, error } = await admin
    .from('wa_ai_agent_knowledge_gaps')
    .select('id, question, answer')
    .eq('organization_id', organizationId)
    .eq('document_id', documentId)
    .eq('status', 'included')
    .order('reviewed_at', { ascending: true });
  if (error) {
    if (isMissingGapsSchema(error)) return [];
    throw new Error(`Falha ao ler as respostas aprendidas: ${error.message}`);
  }
  return ((data ?? []) as Array<{ id: string; question: string; answer: string | null }>)
    .filter(row => (row.answer ?? '').trim())
    .map(row => ({ gapId: row.id, content: learnedChunkContent(row.question, row.answer ?? '') }));
}

/** Documento excluído: as respostas dele voltam para "Abertas", com o texto guardado. Devolve quantas. */
export async function reopenGapsForDocument(admin: SupabaseClient, organizationId: string, documentId: string): Promise<number> {
  const { data, error } = await admin
    .from('wa_ai_agent_knowledge_gaps')
    .update({ status: 'open', document_id: null, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('document_id', documentId)
    .eq('status', 'included')
    .select('id');
  if (error) {
    if (isMissingGapsSchema(error)) return 0;
    throw new Error(`Falha ao devolver as respostas aprendidas: ${error.message}`);
  }
  return ((data ?? []) as unknown[]).length;
}
