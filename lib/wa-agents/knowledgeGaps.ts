/**
 * Dúvidas sem resposta (aprendizado do agente). SERVER.
 *
 * Registro: a ferramenta registrar_duvida_sem_resposta chama `reportGap`
 * (createGapReporter); o texto é saneado, a pergunta ganha embedding e a RPC
 * wa_ai_record_knowledge_gap grava agrupando perguntas de mesmo sentido.
 * Revisão: a resposta aprovada vira um trecho extra (gap_id) do documento
 * escolhido, sem alterar o arquivo original.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUsageContext } from '@/lib/ai-usage/budget';
import { runWithUsageContext } from '@/lib/ai-usage/context';
import { errorMessage } from './errors';
import { agentFilePath } from './files';
import {
  agentEmbeddingProfile,
  documentHeader,
  embedTexts,
  loadAgentDocuments,
  loadDocument,
  MIN_SIMILARITY,
  processDocument,
  type EmbeddingProvider,
} from './knowledge';
import {
  cleanGapText,
  gapQuestionKey,
  isLearnedAnswersDocument,
  learnedChunkContent,
  GAP_ANSWER_MAX,
  GAP_CONTEXT_MAX,
  GAP_LIST_LIMIT,
  GAP_MAX_REPORTS_PER_RUN,
  GAP_OPEN_LIMIT,
  GAP_QUESTION_MAX,
  GAP_SUGGESTED_MAX,
  LEARNED_DOCUMENT_DESCRIPTION,
  LEARNED_DOCUMENT_FILE_NAME,
  LEARNED_DOCUMENT_TEXT,
  LEARNED_DOCUMENT_TITLE,
  type GapReportInput,
  type KnowledgeGapAction,
  type KnowledgeGapListResult,
  type KnowledgeGapRow,
  type KnowledgeGapStatus,
} from './knowledgeGapsShared';
import { isMissingGapsSchema, LEARNED_CHUNK_IDX_BASE } from './learnedAnswers';
import { AGENT_CHUNKS_MAX_PER_AGENT, AGENT_DOCS_MAX_PER_AGENT, WA_AGENT_FILES_BUCKET, type AgentDocumentRow } from './types';

export const KNOWLEDGE_GAPS_TABLE = 'wa_ai_agent_knowledge_gaps';
/** Similaridade mínima (cosseno) para duas perguntas contarem como a mesma dúvida; ajustável com dados reais. */
export const GAP_SIMILARITY_THRESHOLD: Record<EmbeddingProvider, number> = { openai: 0.85, google: 0.92 };
const GAP_EMBED_TIMEOUT_MS = 15_000;

/** Onde a dúvida apareceu: conversa real (com link) ou chat de teste. */
export type GapSource = { kind: 'conversation'; conversationId: string } | { kind: 'test'; sessionId?: string | null };

export type RecordGapResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: 'empty' | 'limit' | 'error'; error?: string };

/** O que a ferramenta devolve ao modelo. */
export type GapToolResult = { ok: true; registrada: true } | { ok: false; erro: string };

type Embedded = { vector: number[]; model: string; provider: EmbeddingProvider };
type SuggestionRow = { document_id: string; similarity?: number };

function sourceKey(source: GapSource): string {
  if (source.kind === 'conversation') return source.conversationId;
  return source.sessionId ? `teste:${source.sessionId}` : 'teste';
}

/** Embedding da pergunta no modelo que a base do agente já usa; null sem chave ou em erro. */
async function embedQuestion(admin: SupabaseClient, organizationId: string, agentId: string, question: string): Promise<Embedded | null> {
  try {
    const profile = await agentEmbeddingProfile(admin, organizationId, agentId);
    const embedded = await embedTexts(admin, organizationId, [question], {
      prefer: profile.model,
      abortSignal: AbortSignal.timeout(GAP_EMBED_TIMEOUT_MS),
    });
    const vector = embedded?.embeddings[0];
    return embedded && vector ? { vector, model: embedded.model, provider: embedded.provider } : null;
  } catch (e) {
    console.error('[wa-agents] embedding da dúvida falhou:', errorMessage(e));
    return null;
  }
}

/** Documento mais parecido com a pergunta (destino sugerido); null sem documentos ou em erro. */
async function nearestDocument(
  admin: SupabaseClient,
  organizationId: string,
  agentId: string,
  question: string,
  embedded: Embedded | null
): Promise<string | null> {
  try {
    if (embedded) {
      const { data, error } = await admin.rpc('wa_ai_match_chunks', {
        p_org: organizationId,
        p_agent: agentId,
        p_embedding: embedded.vector,
        p_limit: 1,
        p_model: embedded.model,
      });
      if (error) throw new Error(error.message);
      const top = ((data ?? []) as SuggestionRow[])[0];
      if (top && typeof top.similarity === 'number' && top.similarity >= MIN_SIMILARITY[embedded.provider]) return top.document_id;
    }
    const { data, error } = await admin.rpc('wa_ai_search_chunks', {
      p_org: organizationId,
      p_agent: agentId,
      p_query: question,
      p_limit: 1,
    });
    if (error) throw new Error(error.message);
    return ((data ?? []) as SuggestionRow[])[0]?.document_id ?? null;
  } catch (e) {
    console.error('[wa-agents] sugestão de documento da dúvida falhou:', errorMessage(e));
    return null;
  }
}

/**
 * Grava a dúvida (ou soma uma ocorrência à dúvida de mesmo sentido). Nunca
 * lança: o atendimento segue mesmo se a gravação falhar.
 */
export async function recordKnowledgeGap(
  admin: SupabaseClient,
  input: GapReportInput & { organizationId: string; agentId: string; source: GapSource }
): Promise<RecordGapResult> {
  const question = cleanGapText(input.pergunta, GAP_QUESTION_MAX, { singleLine: true, mask: true });
  const key = gapQuestionKey(question);
  if (!key) return { ok: false, reason: 'empty' };
  try {
    const embedded = await embedQuestion(admin, input.organizationId, input.agentId, question);
    const suggested = await nearestDocument(admin, input.organizationId, input.agentId, question, embedded);
    const { data, error } = await admin.rpc('wa_ai_record_knowledge_gap', {
      p_org: input.organizationId,
      p_agent: input.agentId,
      p_question: question,
      p_question_key: key,
      p_embedding: embedded?.vector ?? null,
      p_model: embedded?.model ?? null,
      p_threshold: embedded ? GAP_SIMILARITY_THRESHOLD[embedded.provider] : null,
      p_context: cleanGapText(input.o_que_falta, GAP_CONTEXT_MAX, { mask: true }) || null,
      p_suggested_answer: cleanGapText(input.resposta_sugerida, GAP_SUGGESTED_MAX, { mask: true }) || null,
      p_suggested_document: suggested,
      p_source_key: sourceKey(input.source),
      p_conversation: input.source.kind === 'conversation' ? input.source.conversationId : null,
      p_test: input.source.kind === 'test',
      p_open_limit: GAP_OPEN_LIMIT,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { gap_id?: string | null; created?: boolean } | null;
    if (!row?.gap_id) return { ok: false, reason: 'limit' };
    return { ok: true, id: row.gap_id, created: row.created === true };
  } catch (e) {
    console.error('[wa-agents] registrar dúvida falhou:', errorMessage(e));
    return { ok: false, reason: 'error', error: errorMessage(e) };
  }
}

/**
 * `reportGap` de uma execução do agente: no máximo GAP_MAX_REPORTS_PER_RUN
 * dúvidas por resposta e cada pergunta uma vez só. `onEvent` registra o
 * resultado nos eventos da execução (aparecem em Execuções).
 */
export function createGapReporter(
  admin: SupabaseClient,
  base: {
    organizationId: string;
    agentId: string;
    source: GapSource;
    onEvent?: (type: string, extra?: Record<string, unknown>) => void;
  }
): (input: GapReportInput) => Promise<GapToolResult> {
  const seen = new Set<string>();
  let reports = 0;
  return async input => {
    const key = gapQuestionKey(cleanGapText(input.pergunta, GAP_QUESTION_MAX, { singleLine: true, mask: true }));
    if (!key) return { ok: false, erro: 'Escreva a pergunta do cliente.' };
    if (seen.has(key)) return { ok: true, registrada: true };
    if (reports >= GAP_MAX_REPORTS_PER_RUN) {
      return { ok: false, erro: `Limite de ${GAP_MAX_REPORTS_PER_RUN} dúvidas registradas nesta resposta atingido.` };
    }
    seen.add(key);
    reports += 1;
    const result = await recordKnowledgeGap(admin, {
      ...input,
      organizationId: base.organizationId,
      agentId: base.agentId,
      source: base.source,
    });
    if (result.ok) {
      base.onEvent?.('knowledge_gap_recorded', { gap_id: result.id, nova: result.created });
      return { ok: true, registrada: true };
    }
    base.onEvent?.('knowledge_gap_failed', { motivo: result.reason, ...(result.error ? { erro: result.error.slice(0, 300) } : {}) });
    return {
      ok: false,
      erro: result.reason === 'limit' ? 'Limite de dúvidas abertas deste agente atingido.' : 'Não foi possível registrar a dúvida agora.',
    };
  };
}

// ---------------------------------------------------------------------------
// Revisão (tela do agente)
// ---------------------------------------------------------------------------
const GAP_COLUMNS =
  'id, organization_id, agent_id, status, question, context, suggested_answer, answer, document_id, suggested_document_id, occurrences, test_only, last_conversation_id, first_seen_at, last_seen_at, reviewed_by, reviewed_at, created_at, updated_at';
const LEARNED_EMBED_TIMEOUT_MS = 20_000;

export type KnowledgeGapErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_NOT_READY'
  | 'DOCUMENT_LIMIT'
  | 'CHUNK_LIMIT'
  | 'INDEX_FAILED';

/** Erro de regra da revisão: a rota devolve `status` e a mensagem para a tela. */
export class KnowledgeGapError extends Error {
  readonly code: KnowledgeGapErrorCode;
  readonly status: number;

  constructor(code: KnowledgeGapErrorCode, message: string, status: number) {
    super(message);
    this.name = 'KnowledgeGapError';
    this.code = code;
    this.status = status;
  }
}

const conflict = () =>
  new KnowledgeGapError('CONFLICT', 'A dúvida mudou enquanto você revisava. Atualize a lista e tente de novo.', 409);

/** Dúvidas de um status, os totais de cada status e as respostas incluídas por documento. */
export async function listKnowledgeGaps(
  admin: SupabaseClient,
  organizationId: string,
  agentId: string,
  status: KnowledgeGapStatus
): Promise<KnowledgeGapListResult> {
  const scoped = () => admin.from(KNOWLEDGE_GAPS_TABLE);
  const [list, open, ignored, included] = await Promise.all([
    scoped().select(GAP_COLUMNS).eq('organization_id', organizationId).eq('agent_id', agentId).eq('status', status)
      .order('last_seen_at', { ascending: false }).limit(GAP_LIST_LIMIT),
    scoped().select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('agent_id', agentId).eq('status', 'open'),
    scoped().select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('agent_id', agentId).eq('status', 'ignored'),
    scoped().select('document_id').eq('organization_id', organizationId).eq('agent_id', agentId).eq('status', 'included'),
  ]);
  for (const result of [list, open, ignored, included]) {
    if (!result.error) continue;
    if (isMissingGapsSchema(result.error)) return { gaps: [], counts: { open: 0, ignored: 0, included: 0 }, learned_by_document: {} };
    throw new Error(result.error.message);
  }
  const includedRows = (included.data ?? []) as Array<{ document_id: string | null }>;
  const learned: Record<string, number> = {};
  for (const row of includedRows) if (row.document_id) learned[row.document_id] = (learned[row.document_id] ?? 0) + 1;
  return {
    gaps: (list.data ?? []) as unknown as KnowledgeGapRow[],
    counts: { open: open.count ?? 0, ignored: ignored.count ?? 0, included: includedRows.length },
    learned_by_document: learned,
  };
}

/** Dúvidas abertas por agente da organização (etiqueta no cartão do agente). */
export async function openGapCountsByAgent(admin: SupabaseClient, organizationId: string): Promise<Record<string, number>> {
  const { data, error } = await admin
    .from(KNOWLEDGE_GAPS_TABLE)
    .select('agent_id')
    .eq('organization_id', organizationId)
    .eq('status', 'open')
    .limit(10_000);
  if (error) {
    if (isMissingGapsSchema(error)) return {};
    throw new Error(error.message);
  }
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ agent_id: string }>) counts[row.agent_id] = (counts[row.agent_id] ?? 0) + 1;
  return counts;
}

async function loadGap(admin: SupabaseClient, organizationId: string, agentId: string, gapId: string): Promise<KnowledgeGapRow> {
  const { data, error } = await admin
    .from(KNOWLEDGE_GAPS_TABLE)
    .select(GAP_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('agent_id', agentId)
    .eq('id', gapId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new KnowledgeGapError('NOT_FOUND', 'Dúvida não encontrada', 404);
  return data as unknown as KnowledgeGapRow;
}

/** Atualiza só se a dúvida ainda estiver no status esperado (duas pessoas revisando ao mesmo tempo). */
async function updateGap(
  admin: SupabaseClient,
  gap: KnowledgeGapRow,
  expected: KnowledgeGapStatus,
  patch: Record<string, unknown>
): Promise<KnowledgeGapRow> {
  const { data, error } = await admin
    .from(KNOWLEDGE_GAPS_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('organization_id', gap.organization_id)
    .eq('agent_id', gap.agent_id)
    .eq('id', gap.id)
    .eq('status', expected)
    .select(GAP_COLUMNS);
  if (error) throw new Error(error.message);
  const row = ((data ?? []) as unknown as KnowledgeGapRow[])[0];
  if (!row) throw conflict();
  return row;
}

/** Documento "Respostas aprendidas" do agente: reaproveita o existente ou cria, processa e devolve pronto. */
async function ensureLearnedAnswersDocument(
  admin: SupabaseClient,
  input: { organizationId: string; agentId: string; userId: string }
): Promise<AgentDocumentRow> {
  const docs = await loadAgentDocuments(admin, input.organizationId, input.agentId);
  const existing = docs.find(isLearnedAnswersDocument);
  if (existing) {
    if (existing.status !== 'ready') {
      throw new KnowledgeGapError('DOCUMENT_NOT_READY', `O documento “${LEARNED_DOCUMENT_TITLE}” ainda não está pronto. Tente de novo em instantes.`, 409);
    }
    return existing;
  }
  if (docs.length >= AGENT_DOCS_MAX_PER_AGENT) {
    throw new KnowledgeGapError('DOCUMENT_LIMIT', `Limite de ${AGENT_DOCS_MAX_PER_AGENT} documentos por agente. Escolha um documento existente.`, 400);
  }
  const body = Buffer.from(LEARNED_DOCUMENT_TEXT, 'utf8');
  const path = agentFilePath(input.organizationId, input.agentId, 'doc', LEARNED_DOCUMENT_FILE_NAME, randomUUID());
  const { error: uploadError } = await admin.storage.from(WA_AGENT_FILES_BUCKET).upload(path, body, { contentType: 'text/markdown', upsert: false });
  if (uploadError) throw new Error(`Falha ao criar o arquivo do documento: ${uploadError.message}`);
  const { data, error } = await admin
    .from('wa_ai_agent_documents')
    .insert({
      organization_id: input.organizationId,
      agent_id: input.agentId,
      name: LEARNED_DOCUMENT_FILE_NAME,
      title: LEARNED_DOCUMENT_TITLE,
      description: LEARNED_DOCUMENT_DESCRIPTION,
      tags: [],
      mime: 'text/markdown',
      size_bytes: body.byteLength,
      storage_path: path,
      status: 'processing',
      error: null,
      chunk_count: 0,
      created_by: input.userId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Falha ao registrar o documento: ${error?.message ?? 'sem resposta'}`);
  const documentId = (data as { id: string }).id;
  const processed = await processDocument(admin, { organizationId: input.organizationId, documentId });
  if (!processed.ok) {
    throw new KnowledgeGapError('INDEX_FAILED', `Não foi possível preparar o documento: ${processed.error ?? 'erro desconhecido'}`, 502);
  }
  const doc = await loadDocument(admin, input.organizationId, documentId);
  if (!doc || doc.status !== 'ready') {
    throw new KnowledgeGapError('INDEX_FAILED', `Não foi possível preparar o documento “${LEARNED_DOCUMENT_TITLE}”.`, 502);
  }
  return doc;
}

/** Documento de destino da resposta: do agente e pronto. */
async function resolveDestination(
  admin: SupabaseClient,
  input: { organizationId: string; agentId: string; userId: string; documentId?: string; createDocument: boolean }
): Promise<AgentDocumentRow> {
  if (input.createDocument) return ensureLearnedAnswersDocument(admin, input);
  const doc = input.documentId ? await loadDocument(admin, input.organizationId, input.documentId) : null;
  if (!doc || doc.agent_id !== input.agentId) throw new KnowledgeGapError('DOCUMENT_NOT_FOUND', 'Documento de destino não encontrado', 404);
  if (doc.status === 'processing') {
    throw new KnowledgeGapError('DOCUMENT_NOT_READY', 'O documento está sendo processado. Tente de novo em instantes.', 409);
  }
  if (doc.status !== 'ready') {
    throw new KnowledgeGapError('DOCUMENT_NOT_READY', 'O documento está com erro. Reprocesse antes de incluir a resposta.', 409);
  }
  return doc;
}

async function assertChunkRoom(admin: SupabaseClient, organizationId: string, agentId: string): Promise<void> {
  const profile = await agentEmbeddingProfile(admin, organizationId, agentId);
  if (profile.chunks + 1 > AGENT_CHUNKS_MAX_PER_AGENT) {
    throw new KnowledgeGapError('CHUNK_LIMIT', `Limite de ${AGENT_CHUNKS_MAX_PER_AGENT} trechos por agente atingido. Remova documentos antes de incluir mais respostas.`, 400);
  }
}

/** Embedding do trecho no modelo do documento (cabeçalho igual ao dos trechos do arquivo); sem modelo, fica só a busca por texto. */
async function embedLearnedChunk(admin: SupabaseClient, doc: AgentDocumentRow, content: string): Promise<{ embedding: number[] | null; model: string | null }> {
  if (!doc.embedding_model) return { embedding: null, model: null };
  try {
    const usage = await createUsageContext(admin, { organizationId: doc.organization_id, agentId: doc.agent_id, scope: 'knowledge' });
    return await runWithUsageContext(usage, async () => {
      const embedded = await embedTexts(admin, doc.organization_id, [`${documentHeader(doc)}\n${content}`], {
        prefer: doc.embedding_model,
        abortSignal: AbortSignal.timeout(LEARNED_EMBED_TIMEOUT_MS),
      });
      return embedded ? { embedding: embedded.embeddings[0] ?? null, model: embedded.model } : { embedding: null, model: null };
    });
  } catch (e) {
    throw new KnowledgeGapError('INDEX_FAILED', `Não foi possível indexar a resposta agora: ${errorMessage(e)}`, 502);
  }
}

async function insertLearnedChunk(admin: SupabaseClient, doc: AgentDocumentRow, gapId: string, content: string): Promise<string> {
  const { embedding, model } = await embedLearnedChunk(admin, doc, content);
  const { data, error } = await admin
    .from('wa_ai_agent_chunks')
    .insert({
      organization_id: doc.organization_id,
      agent_id: doc.agent_id,
      document_id: doc.id,
      idx: LEARNED_CHUNK_IDX_BASE,
      content,
      embedding,
      embedding_model: model,
      gap_id: gapId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Falha ao gravar o trecho da resposta: ${error?.message ?? 'sem resposta'}`);
  return (data as { id: string }).id;
}

/** Apaga os trechos da dúvida (menos `keepChunkId`, o trecho novo de uma edição). */
async function deleteLearnedChunks(admin: SupabaseClient, organizationId: string, gapId: string, keepChunkId?: string): Promise<void> {
  let query = admin.from('wa_ai_agent_chunks').delete().eq('organization_id', organizationId).eq('gap_id', gapId);
  if (keepChunkId) query = query.neq('id', keepChunkId);
  const { error } = await query;
  if (error) throw new Error(`Falha ao apagar o trecho da resposta: ${error.message}`);
}

async function deleteChunk(admin: SupabaseClient, organizationId: string, chunkId: string): Promise<void> {
  const { error } = await admin.from('wa_ai_agent_chunks').delete().eq('organization_id', organizationId).eq('id', chunkId);
  if (error) throw new Error(error.message);
}

/** chunk_count do documento pela contagem real dos trechos (arquivo + respostas aprendidas). */
async function refreshChunkCount(admin: SupabaseClient, organizationId: string, documentId: string): Promise<void> {
  const { count, error } = await admin
    .from('wa_ai_agent_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('document_id', documentId);
  if (error) throw new Error(error.message);
  const { error: updateError } = await admin
    .from('wa_ai_agent_documents')
    .update({ chunk_count: count ?? 0, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('id', documentId);
  if (updateError) throw new Error(updateError.message);
}

/** Aplica uma ação da tela: incluir, editar, tirar da base, ignorar ou reabrir. */
export async function applyKnowledgeGapAction(
  admin: SupabaseClient,
  input: { organizationId: string; agentId: string; gapId: string; userId: string; action: KnowledgeGapAction }
): Promise<KnowledgeGapRow> {
  const gap = await loadGap(admin, input.organizationId, input.agentId, input.gapId);
  const action = input.action;
  switch (action.action) {
    case 'ignore':
      if (gap.status !== 'open') throw conflict();
      return updateGap(admin, gap, 'open', { status: 'ignored' });
    case 'reopen':
      if (gap.status !== 'ignored') throw conflict();
      return updateGap(admin, gap, 'ignored', { status: 'open' });
    case 'remove': {
      if (gap.status !== 'included') throw conflict();
      const updated = await updateGap(admin, gap, 'included', { status: 'ignored', document_id: null });
      await deleteLearnedChunks(admin, gap.organization_id, gap.id);
      if (gap.document_id) await refreshChunkCount(admin, gap.organization_id, gap.document_id);
      return updated;
    }
    case 'include':
    case 'edit': {
      const expected: KnowledgeGapStatus = action.action === 'include' ? 'open' : 'included';
      if (gap.status !== expected) throw conflict();
      const question = cleanGapText(action.question, GAP_QUESTION_MAX, { singleLine: true });
      const answer = cleanGapText(action.answer, GAP_ANSWER_MAX);
      const doc = await resolveDestination(admin, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        userId: input.userId,
        documentId: action.document_id,
        createDocument: action.create_document === true,
      });
      if (action.action === 'include' || doc.id !== gap.document_id) await assertChunkRoom(admin, input.organizationId, input.agentId);
      const chunkId = await insertLearnedChunk(admin, doc, gap.id, learnedChunkContent(question, answer));
      let updated: KnowledgeGapRow;
      try {
        updated = await updateGap(admin, gap, expected, {
          status: 'included',
          question,
          question_key: gapQuestionKey(question),
          answer,
          document_id: doc.id,
          reviewed_by: input.userId,
          reviewed_at: new Date().toISOString(),
        });
      } catch (e) {
        await deleteChunk(admin, input.organizationId, chunkId).catch(() => undefined);
        throw e;
      }
      // O trecho antigo da edição sai (no mesmo documento ou no anterior)
      await deleteLearnedChunks(admin, input.organizationId, gap.id, chunkId);
      await refreshChunkCount(admin, input.organizationId, doc.id);
      if (gap.document_id && gap.document_id !== doc.id) await refreshChunkCount(admin, input.organizationId, gap.document_id);
      return updated;
    }
    default:
      throw conflict();
  }
}

/** Exclui uma dúvida aberta ou ignorada (a incluída precisa sair da base antes). */
export async function deleteKnowledgeGap(
  admin: SupabaseClient,
  input: { organizationId: string; agentId: string; gapId: string }
): Promise<void> {
  const gap = await loadGap(admin, input.organizationId, input.agentId, input.gapId);
  if (gap.status === 'included') throw new KnowledgeGapError('CONFLICT', 'Tire a resposta da base antes de excluir a dúvida.', 409);
  const { error } = await admin
    .from(KNOWLEDGE_GAPS_TABLE)
    .delete()
    .eq('organization_id', gap.organization_id)
    .eq('agent_id', gap.agent_id)
    .eq('id', gap.id)
    .neq('status', 'included');
  if (error) throw new Error(error.message);
}
