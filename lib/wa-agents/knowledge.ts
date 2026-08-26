/**
 * Base de conhecimento do agente: extração de texto dos documentos (PDF, DOCX,
 * texto/markdown), divisão em trechos, embeddings e busca (vetorial com
 * reserva por texto). SERVER.
 *
 * Embeddings: OpenAI text-embedding-3-small (1536) com a chave da org; sem ela,
 * Google gemini-embedding-001 com outputDimensionality 1536; sem chave nenhuma
 * os trechos ficam só com a busca por texto (wa_ai_search_chunks). O modelo
 * usado fica gravado em cada trecho (embedding_model): a consulta usa o mesmo
 * modelo dos trechos do agente e nunca compara vetores de modelos diferentes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany, type EmbeddingModel } from 'ai';
import { errorMessage } from './errors';
import { getOrganizationApiKey } from './model';
import { getAgentFileInfo } from './storage';
import {
  AGENT_CHUNKS_MAX_PER_AGENT,
  AGENT_DOC_MAX_BYTES,
  AGENT_DOC_MIMES,
  WA_AGENT_FILES_BUCKET,
  type AgentDocumentRow,
  type AgentDocumentStatus,
  type AgentRow,
  type KnowledgeHit,
} from './types';

export type { KnowledgeHit };

/** Limite do texto extraído de um documento (2 MB de caracteres). */
export const MAX_DOCUMENT_TEXT_CHARS = 2 * 1024 * 1024;
/** Arquivos de texto/markdown: bytes lidos antes da limpeza (o resto é descartado). */
export const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;
/** Dimensão dos vetores (coluna embedding vector(1536)). */
export const EMBEDDING_DIMENSIONS = 1536;
const EMBED_BATCH_SIZE = 64;
const CHUNK_INSERT_BATCH = 100;
/** Tamanho máximo do texto de uma consulta enviada para embedding. */
const MAX_QUERY_CHARS = 2000;

/** Prazo total do processamento de um documento (abaixo do maxDuration de 300 s da rota). */
export const PROCESS_TIMEOUT_MS = 240_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const EXTRACT_TIMEOUT_MS = 60_000;
const QUERY_EMBED_TIMEOUT_MS = 20_000;
/** Documento 'processing' há mais tempo que isso foi interrompido (função morta): vira erro reprocessável. */
export const PROCESSING_STALE_MS = 6 * 60_000;
export const PROCESSING_STALE_ERROR = 'Processamento interrompido (tempo esgotado). Reprocesse o documento.';

// ---------------------------------------------------------------------------
// Modelos de embedding (procedência gravada em cada trecho)
// ---------------------------------------------------------------------------
export type EmbeddingProvider = 'openai' | 'google';
export const EMBEDDING_MODEL_IDS = {
  openai: 'openai:text-embedding-3-small',
  google: 'google:gemini-embedding-001',
} as const;
export type EmbeddingModelId = (typeof EMBEDDING_MODEL_IDS)[EmbeddingProvider];

/**
 * Similaridade mínima (cosseno) para um trecho contar como relevante, por
 * provedor: os embeddings do Gemini deixam textos sem relação bem acima do
 * 0.2 que serve para a OpenAI.
 */
export const MIN_SIMILARITY: Record<EmbeddingProvider, number> = { openai: 0.2, google: 0.5 };

export const DOCUMENT_COLUMNS =
  'id, organization_id, agent_id, name, mime, size_bytes, storage_path, status, error, chunk_count, embedding_model, created_by, created_at, updated_at';

/** Promise com prazo: rejeita com uma mensagem clara quando `ms` passa. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado (${label})`)), Math.max(1, ms));
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Tipo de arquivo
// ---------------------------------------------------------------------------
const EXT_MIME: Record<string, (typeof AGENT_DOC_MIMES)[number]> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Mime aceito do documento a partir do mime informado ou da extensão do nome
 * (navegadores mandam "application/octet-stream" ou vazio para .md/.docx).
 * null quando o tipo não é suportado.
 */
export function resolveDocumentMime(mime: string | null | undefined, name: string): (typeof AGENT_DOC_MIMES)[number] | null {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase();
  if ((AGENT_DOC_MIMES as readonly string[]).includes(m)) return m as (typeof AGENT_DOC_MIMES)[number];
  if (m === 'text/x-markdown') return 'text/markdown';
  const ext = (name ?? '').toLowerCase().split('.').pop() ?? '';
  return EXT_MIME[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Extração de texto
// ---------------------------------------------------------------------------
/** Limpa o texto extraído: quebras normalizadas, espaços repetidos, sem caracteres de controle. */
export function cleanExtractedText(text: string): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extrai o texto de um documento (PDF via unpdf, DOCX via mammoth, texto e
 * markdown em utf-8). Lança quando o tipo não é suportado ou o arquivo não
 * pode ser lido. Limite de 2 MB de texto (arquivos de texto: 4 MB lidos).
 */
export async function extractDocumentText(buffer: Buffer, mime: string, name: string): Promise<string> {
  const kind = resolveDocumentMime(mime, name);
  if (!kind) throw new Error('Tipo de arquivo não suportado (use PDF, DOCX, TXT ou MD)');
  let text = '';
  if (kind === 'application/pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else if (kind === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    // Corta o buffer ANTES de virar string: as regex da limpeza não passam por 50 MB
    const slice = buffer.length > MAX_TEXT_FILE_BYTES ? buffer.subarray(0, MAX_TEXT_FILE_BYTES) : buffer;
    text = slice.toString('utf-8');
    // BOM do utf-8
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  // Texto bruto limitado antes da limpeza (PDF/DOCX gigantes)
  if (text.length > 2 * MAX_DOCUMENT_TEXT_CHARS) text = text.slice(0, 2 * MAX_DOCUMENT_TEXT_CHARS);
  const clean = cleanExtractedText(text);
  return clean.length > MAX_DOCUMENT_TEXT_CHARS ? clean.slice(0, MAX_DOCUMENT_TEXT_CHARS) : clean;
}

// ---------------------------------------------------------------------------
// Divisão em trechos
// ---------------------------------------------------------------------------
export type ChunkOptions = { size?: number; overlap?: number };

/** Divide um pedaço longo em frases (ou, sem pontuação, em palavras). */
function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?;:])\s+/).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

/** Sobreposição: as últimas palavras do trecho anterior (até `overlap` caracteres, sem cortar palavras). */
function tailWords(text: string, overlap: number): string {
  if (overlap <= 0 || !text) return '';
  const words = text.split(/\s+/);
  const out: string[] = [];
  let len = 0;
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (len + w.length + (out.length ? 1 : 0) > overlap) break;
    out.unshift(w);
    len += w.length + 1;
  }
  return out.join(' ');
}

/** Quebra uma unidade maior que `size` em pedaços por palavras (nunca corta uma palavra). */
function splitLongUnit(unit: string, size: number): string[] {
  const words = unit.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length > size) {
      out.push(cur);
      cur = w;
    } else {
      cur = `${cur} ${w}`;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Divide o texto em trechos de até `size` caracteres, respeitando parágrafos
 * e frases (nunca corta palavras), com `overlap` caracteres de sobreposição
 * entre trechos consecutivos.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = Math.max(100, opts.size ?? 900);
  const overlap = Math.max(0, Math.min(opts.overlap ?? 150, Math.floor(size / 2)));
  const clean = cleanExtractedText(text);
  if (!clean) return [];

  // Unidades: parágrafos; parágrafos maiores que o limite viram frases; frases gigantes viram pedaços por palavra
  const units: string[] = [];
  for (const para of clean.split(/\n\s*\n/)) {
    const p = para.replace(/\s*\n\s*/g, ' ').trim();
    if (!p) continue;
    if (p.length <= size) {
      units.push(p);
      continue;
    }
    for (const s of splitSentences(p)) {
      if (s.length <= size) units.push(s);
      else units.push(...splitLongUnit(s, size));
    }
  }

  const chunks: string[] = [];
  let cur = '';
  for (const u of units) {
    if (!cur) {
      cur = u;
      continue;
    }
    if (cur.length + 1 + u.length > size) {
      chunks.push(cur);
      const tail = tailWords(cur, overlap);
      cur = tail && tail.length + 1 + u.length <= size ? `${tail} ${u}` : u;
    } else {
      cur = `${cur} ${u}`;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------
type EmbeddingSetup = {
  model: EmbeddingModel;
  provider: EmbeddingProvider;
  id: EmbeddingModelId;
  /** Google: gemini-embedding-001 nasce com 3072 dimensões; pedimos 1536 (coluna vector(1536)) */
  providerOptions?: { google: { outputDimensionality: number } };
};

function setupFor(provider: EmbeddingProvider, apiKey: string): EmbeddingSetup {
  if (provider === 'google') {
    return {
      model: createGoogleGenerativeAI({ apiKey }).textEmbeddingModel('gemini-embedding-001'),
      provider,
      id: EMBEDDING_MODEL_IDS.google,
      providerOptions: { google: { outputDimensionality: EMBEDDING_DIMENSIONS } },
    };
  }
  return { model: createOpenAI({ apiKey }).textEmbeddingModel('text-embedding-3-small'), provider, id: EMBEDDING_MODEL_IDS.openai };
}

/** Provedor de um id de modelo de embedding gravado nos trechos; null se desconhecido. */
export function embeddingProviderOf(modelId: string | null | undefined): EmbeddingProvider | null {
  if (modelId === EMBEDDING_MODEL_IDS.openai) return 'openai';
  if (modelId === EMBEDDING_MODEL_IDS.google) return 'google';
  return null;
}

/**
 * Modelo de embedding disponível para a org: o preferido (`prefer`, modelo já
 * usado nos trechos do agente) quando a chave existe; senão OpenAI e depois
 * Google. null sem chave nenhuma.
 */
export async function resolveEmbeddingModel(
  admin: SupabaseClient,
  organizationId: string,
  prefer?: string | null
): Promise<EmbeddingSetup | null> {
  const preferred = embeddingProviderOf(prefer);
  const order: EmbeddingProvider[] = preferred === 'google' ? ['google', 'openai'] : ['openai', 'google'];
  for (const provider of order) {
    const key = await getOrganizationApiKey(admin, organizationId, provider);
    if (key) return setupFor(provider, key);
  }
  return null;
}

export type EmbedTextsResult = { embeddings: number[][]; model: EmbeddingModelId; provider: EmbeddingProvider };

/**
 * Embeddings dos textos (1536 dimensões), em lotes de 64, com o modelo usado.
 * null quando a org não tem chave OpenAI nem Google (fica só a busca por
 * texto). Lança em erro do provedor ou quando `abortSignal` dispara.
 */
export async function embedTexts(
  admin: SupabaseClient,
  organizationId: string,
  texts: string[],
  opts: { prefer?: string | null; abortSignal?: AbortSignal } = {}
): Promise<EmbedTextsResult | null> {
  const setup = await resolveEmbeddingModel(admin, organizationId, opts.prefer);
  if (!setup) return null;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const { embeddings } = await embedMany({
      model: setup.model,
      values: batch,
      providerOptions: setup.providerOptions,
      maxParallelCalls: 2,
      abortSignal: opts.abortSignal,
    });
    for (const e of embeddings) {
      if (e.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Embedding com ${e.length} dimensões (esperado ${EMBEDDING_DIMENSIONS})`);
      }
      out.push(Array.from(e));
    }
  }
  return { embeddings: out, model: setup.id, provider: setup.provider };
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------
/** true quando o documento está 'processing' há mais tempo que o prazo (função interrompida). */
export function isProcessingStale(doc: Pick<AgentDocumentRow, 'status' | 'updated_at' | 'created_at'>, now = Date.now()): boolean {
  if (doc.status !== 'processing') return false;
  const t = new Date(doc.updated_at || doc.created_at).getTime();
  return Number.isFinite(t) && now - t > PROCESSING_STALE_MS;
}

/**
 * Documentos 'processing' interrompidos (updated_at velho) viram 'error'
 * reprocessável, no banco e na lista devolvida.
 */
async function settleStaleProcessing(admin: SupabaseClient, organizationId: string, docs: AgentDocumentRow[]): Promise<AgentDocumentRow[]> {
  const stale = docs.filter(d => isProcessingStale(d));
  if (stale.length === 0) return docs;
  const now = new Date().toISOString();
  try {
    await admin
      .from('wa_ai_agent_documents')
      .update({ status: 'error', error: PROCESSING_STALE_ERROR, chunk_count: 0, updated_at: now })
      .eq('organization_id', organizationId)
      .eq('status', 'processing')
      .in(
        'id',
        stale.map(d => d.id)
      );
  } catch (e) {
    console.error('[wa-agents] marcar documento interrompido falhou:', errorMessage(e));
  }
  const ids = new Set(stale.map(d => d.id));
  return docs.map(d => (ids.has(d.id) ? { ...d, status: 'error' as const, error: PROCESSING_STALE_ERROR, chunk_count: 0, updated_at: now } : d));
}

export async function loadDocument(
  admin: SupabaseClient,
  organizationId: string,
  documentId: string
): Promise<AgentDocumentRow | null> {
  const { data } = await admin
    .from('wa_ai_agent_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', documentId)
    .maybeSingle();
  const doc = (data as AgentDocumentRow | null) ?? null;
  if (!doc) return null;
  return (await settleStaleProcessing(admin, organizationId, [doc]))[0] ?? null;
}

/** Documentos de um agente (todos os status, mais recentes primeiro); 'processing' interrompido vira erro. */
export async function loadAgentDocuments(
  admin: SupabaseClient,
  organizationId: string,
  agentId: string
): Promise<AgentDocumentRow[]> {
  const { data } = await admin
    .from('wa_ai_agent_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });
  return settleStaleProcessing(admin, organizationId, (data ?? []) as AgentDocumentRow[]);
}

/** Só os documentos prontos (com trechos) de um agente. */
export async function loadReadyDocuments(
  admin: SupabaseClient,
  organizationId: string,
  agentId: string
): Promise<AgentDocumentRow[]> {
  const { data } = await admin
    .from('wa_ai_agent_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('agent_id', agentId)
    .eq('status', 'ready')
    .gt('chunk_count', 0)
    .order('created_at', { ascending: true });
  return (data ?? []) as AgentDocumentRow[];
}

/** Modelo de embedding já usado nos documentos prontos do agente (o mais comum) e total de trechos. */
async function agentEmbeddingProfile(
  admin: SupabaseClient,
  organizationId: string,
  agentId: string,
  exceptDocumentId?: string
): Promise<{ model: string | null; chunks: number }> {
  const { data } = await admin
    .from('wa_ai_agent_documents')
    .select('id, chunk_count, embedding_model')
    .eq('organization_id', organizationId)
    .eq('agent_id', agentId)
    .eq('status', 'ready');
  const counts = new Map<string, number>();
  let chunks = 0;
  for (const d of (data ?? []) as Array<{ id: string; chunk_count: number; embedding_model: string | null }>) {
    if (d.id === exceptDocumentId) continue;
    chunks += Number(d.chunk_count) || 0;
    if (d.embedding_model) counts.set(d.embedding_model, (counts.get(d.embedding_model) ?? 0) + (Number(d.chunk_count) || 1));
  }
  let model: string | null = null;
  let best = 0;
  for (const [m, n] of counts) {
    if (n > best) {
      best = n;
      model = m;
    }
  }
  return { model, chunks };
}

async function setDocumentStatus(
  admin: SupabaseClient,
  doc: Pick<AgentDocumentRow, 'id' | 'organization_id'>,
  patch: { status: AgentDocumentStatus; error?: string | null; chunk_count?: number; embedding_model?: string | null }
): Promise<void> {
  const { error } = await admin
    .from('wa_ai_agent_documents')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('organization_id', doc.organization_id)
    .eq('id', doc.id);
  if (error) console.error('[wa-agents] atualizar status do documento falhou:', error.message);
}

/** Apaga os trechos de um documento. */
export async function deleteDocumentChunks(
  admin: SupabaseClient,
  organizationId: string,
  documentId: string
): Promise<void> {
  const { error } = await admin
    .from('wa_ai_agent_chunks')
    .delete()
    .eq('organization_id', organizationId)
    .eq('document_id', documentId);
  if (error) throw new Error(error.message);
}

export type ProcessDocumentResult = { ok: boolean; chunkCount: number; embedded: boolean; error?: string };

/**
 * Processa um documento: baixa do bucket wa-agent-files, extrai o texto,
 * divide em trechos, gera embeddings (quando há chave) e grava os trechos
 * (apagando os antigos). Deixa o documento 'ready' (com chunk_count) ou
 * 'error' (com a mensagem). Tem prazo global (240 s) e por etapa; nunca lança.
 */
export async function processDocument(
  admin: SupabaseClient,
  input: { organizationId: string; documentId: string }
): Promise<ProcessDocumentResult> {
  const doc = await loadDocument(admin, input.organizationId, input.documentId);
  if (!doc) return { ok: false, chunkCount: 0, embedded: false, error: 'Documento não encontrado' };
  await setDocumentStatus(admin, doc, { status: 'processing', error: null });

  const deadline = Date.now() + PROCESS_TIMEOUT_MS;
  const remaining = (label: string) => {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`Tempo esgotado (${label})`);
    return left;
  };
  const abort = AbortSignal.timeout(PROCESS_TIMEOUT_MS);

  try {
    // Segurança: o caminho precisa ser da org (o bucket é compartilhado)
    if (!doc.storage_path.startsWith(`${doc.organization_id}/`)) throw new Error('Caminho do arquivo inválido');

    // Tamanho real do objeto antes de baixar
    const info = await getAgentFileInfo(admin, doc.storage_path);
    if (!info) throw new Error('Arquivo não encontrado no armazenamento');
    if (typeof info.size === 'number' && info.size > AGENT_DOC_MAX_BYTES) {
      throw new Error(`Arquivo maior que o limite de ${Math.round(AGENT_DOC_MAX_BYTES / 1024 / 1024)} MB`);
    }

    const { data: blob, error: dlError } = await withTimeout(
      admin.storage.from(WA_AGENT_FILES_BUCKET).download(doc.storage_path),
      Math.min(DOWNLOAD_TIMEOUT_MS, remaining('download')),
      'download do arquivo'
    );
    if (dlError || !blob) throw new Error(`Falha ao baixar o arquivo: ${dlError?.message ?? 'arquivo não encontrado'}`);
    if (blob.size > AGENT_DOC_MAX_BYTES) {
      throw new Error(`Arquivo maior que o limite de ${Math.round(AGENT_DOC_MAX_BYTES / 1024 / 1024)} MB`);
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    const text = await withTimeout(
      extractDocumentText(buffer, doc.mime ?? '', doc.name),
      Math.min(EXTRACT_TIMEOUT_MS, remaining('extração')),
      'extração do texto'
    );
    if (!text) throw new Error('Não foi possível extrair texto do arquivo (PDF só com imagens?)');

    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error('O documento não tem texto aproveitável');

    // Teto de trechos por agente (somando os outros documentos prontos)
    const profile = await agentEmbeddingProfile(admin, doc.organization_id, doc.agent_id, doc.id);
    if (profile.chunks + chunks.length > AGENT_CHUNKS_MAX_PER_AGENT) {
      throw new Error(
        `Limite de ${AGENT_CHUNKS_MAX_PER_AGENT} trechos por agente ultrapassado (este documento tem ${chunks.length}; os demais somam ${profile.chunks}). Remova documentos ou envie um arquivo menor.`
      );
    }

    remaining('embeddings');
    let embedded: EmbedTextsResult | null = null;
    try {
      embedded = await embedTexts(admin, doc.organization_id, chunks, { prefer: profile.model, abortSignal: abort });
    } catch (e) {
      // Sem embedding o documento continua útil pela busca por texto
      console.error('[wa-agents] embeddings falharam, seguindo só com busca por texto:', errorMessage(e));
      embedded = null;
    }

    remaining('gravação');
    await deleteDocumentChunks(admin, doc.organization_id, doc.id);
    for (let i = 0; i < chunks.length; i += CHUNK_INSERT_BATCH) {
      const rows = chunks.slice(i, i + CHUNK_INSERT_BATCH).map((content, j) => ({
        organization_id: doc.organization_id,
        agent_id: doc.agent_id,
        document_id: doc.id,
        idx: i + j,
        content,
        embedding: embedded ? embedded.embeddings[i + j] : null,
        embedding_model: embedded ? embedded.model : null,
      }));
      const { error } = await admin.from('wa_ai_agent_chunks').insert(rows);
      if (error) throw new Error(`Falha ao gravar os trechos: ${error.message}`);
    }

    await setDocumentStatus(admin, doc, {
      status: 'ready',
      error: null,
      chunk_count: chunks.length,
      embedding_model: embedded ? embedded.model : null,
    });
    return { ok: true, chunkCount: chunks.length, embedded: !!embedded };
  } catch (e) {
    const msg = errorMessage(e).slice(0, 1000);
    console.error('[wa-agents] processar documento falhou:', msg);
    await setDocumentStatus(admin, doc, { status: 'error', error: msg, chunk_count: 0, embedding_model: null });
    return { ok: false, chunkCount: 0, embedded: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------
type MatchRow = { id: string; document_id: string; idx: number; content: string; similarity: number };
type SearchRow = { id: string; document_id: string; idx: number; content: string; rank: number };

/**
 * Busca trechos relevantes na base do agente: embute a pergunta com o mesmo
 * modelo dos trechos do agente (quando há chave) e usa wa_ai_match_chunks
 * (só trechos desse modelo, limiar por provedor); sem embedding ou sem
 * resultado, cai na busca por texto wa_ai_search_chunks. Nunca lança (devolve []).
 */
export async function searchKnowledge(
  admin: SupabaseClient,
  input: { organizationId: string; agent: Pick<AgentRow, 'id' | 'organization_id'>; query: string; limit?: number }
): Promise<KnowledgeHit[]> {
  const query = (input.query ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
  if (!query) return [];
  if (input.agent.organization_id !== input.organizationId) return [];
  const limit = Math.max(1, Math.min(input.limit ?? 5, 20));

  try {
    let embedded: EmbedTextsResult | null = null;
    try {
      const profile = await agentEmbeddingProfile(admin, input.organizationId, input.agent.id);
      embedded = await embedTexts(admin, input.organizationId, [query], {
        prefer: profile.model,
        abortSignal: AbortSignal.timeout(QUERY_EMBED_TIMEOUT_MS),
      });
    } catch (e) {
      console.error('[wa-agents] embedding da consulta falhou:', errorMessage(e));
    }

    const vector = embedded?.embeddings[0] ?? null;
    if (vector && embedded) {
      const minSimilarity = MIN_SIMILARITY[embedded.provider];
      const { data, error } = await admin.rpc('wa_ai_match_chunks', {
        p_org: input.organizationId,
        p_agent: input.agent.id,
        p_embedding: vector,
        p_limit: limit,
        p_model: embedded.model,
      });
      if (error) console.error('[wa-agents] busca vetorial falhou:', error.message);
      const hits = ((data ?? []) as MatchRow[])
        .filter(r => typeof r.similarity === 'number' && r.similarity >= minSimilarity)
        .map(r => ({ content: r.content, document_id: r.document_id, idx: r.idx, score: r.similarity }));
      if (hits.length > 0) return hits;
    }

    const { data, error } = await admin.rpc('wa_ai_search_chunks', {
      p_org: input.organizationId,
      p_agent: input.agent.id,
      p_query: query,
      p_limit: limit,
    });
    if (error) {
      console.error('[wa-agents] busca por texto falhou:', error.message);
      return [];
    }
    return ((data ?? []) as SearchRow[]).map(r => ({
      content: r.content,
      document_id: r.document_id,
      idx: r.idx,
      score: typeof r.rank === 'number' ? r.rank : 0,
    }));
  } catch (e) {
    console.error('[wa-agents] busca na base de conhecimento falhou:', errorMessage(e));
    return [];
  }
}

/** Texto dos trechos para o modelo (nome do documento quando conhecido). */
export function formatKnowledgeHits(
  hits: KnowledgeHit[],
  documents: Array<Pick<AgentDocumentRow, 'id' | 'name'>> = [],
  maxChars = 6000
): string {
  if (hits.length === 0) return '';
  const names = new Map(documents.map(d => [d.id, d.name]));
  const lines: string[] = [];
  let total = 0;
  for (const [i, h] of hits.entries()) {
    const name = names.get(h.document_id);
    const content = h.content.replace(/\s+/g, ' ').trim();
    const line = `[${i + 1}]${name ? ` (${name})` : ''} ${content}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join('\n');
}
