/**
 * Dúvidas sem resposta (aprendizado do agente): tipos, limites, ações da tela
 * e funções de texto usadas no servidor e na interface.
 *
 * CLIENT-SAFE: só funções puras.
 */
import { z } from 'zod';
import { normalizeKeyword } from './text';

export const KNOWLEDGE_GAP_STATUSES = ['open', 'ignored', 'included'] as const;
export type KnowledgeGapStatus = (typeof KNOWLEDGE_GAP_STATUSES)[number];

/** Limites dos textos gravados (o banco confere os mesmos). */
export const GAP_QUESTION_MAX = 300;
export const GAP_CONTEXT_MAX = 800;
export const GAP_SUGGESTED_MAX = 2000;
export const GAP_ANSWER_MAX = 4000;
/** A ferramenta aceita textos maiores para o modelo não receber erro de validação; o servidor corta. */
export const GAP_TOOL_INPUT_MAX = 4000;
/** Dúvidas abertas por agente: acima disso, perguntas novas são descartadas. */
export const GAP_OPEN_LIMIT = 200;
/** Dúvidas devolvidas de uma vez para a tela. */
export const GAP_LIST_LIMIT = 200;
/** Registros por resposta do agente. */
export const GAP_MAX_REPORTS_PER_RUN = 2;
/** "Perguntada de novo depois de incluída": só quando passou deste tempo desde a revisão. */
export const GAP_REAPPEARED_AFTER_MS = 10 * 60_000;

/** Documento criado pela opção "Novo documento: Respostas aprendidas". */
export const LEARNED_DOCUMENT_TITLE = 'Respostas aprendidas';
export const LEARNED_DOCUMENT_FILE_NAME = 'Respostas aprendidas.md';
export const LEARNED_DOCUMENT_DESCRIPTION = 'Respostas da equipe para dúvidas dos clientes.';
export const LEARNED_DOCUMENT_TEXT = `# ${LEARNED_DOCUMENT_TITLE}\n\n${LEARNED_DOCUMENT_DESCRIPTION}\n`;

export const MASKED_PERSONAL_DATA = '[dado removido]';

/** Entrada da ferramenta registrar_duvida_sem_resposta. */
export type GapReportInput = { pergunta: string; o_que_falta?: string; resposta_sugerida?: string };

export type KnowledgeGapRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  status: KnowledgeGapStatus;
  question: string;
  context: string | null;
  suggested_answer: string | null;
  answer: string | null;
  document_id: string | null;
  suggested_document_id: string | null;
  occurrences: number;
  test_only: boolean;
  last_conversation_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeGapCounts = Record<KnowledgeGapStatus, number>;

export type KnowledgeGapListResult = {
  gaps: KnowledgeGapRow[];
  counts: KnowledgeGapCounts;
  /** Respostas incluídas por documento (lista de documentos e confirmação de exclusão) */
  learned_by_document: Record<string, number>;
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const PHONE_RE = /(?:\+?55[\s-]?)?(?:\(\d{2}\)|\b\d{2})[\s-]?9?\d{4}[\s-]?\d{4}\b/g;

/** Mascara e-mail, CNPJ, CPF e telefone que escaparem da instrução de escrever sem dados do cliente. */
export function maskPersonalData(text: string): string {
  return text
    .replace(EMAIL_RE, MASKED_PERSONAL_DATA)
    .replace(CNPJ_RE, MASKED_PERSONAL_DATA)
    .replace(CPF_RE, MASKED_PERSONAL_DATA)
    .replace(PHONE_RE, MASKED_PERSONAL_DATA);
}

/** Troca caracteres de controle (menos tab e quebra de linha) por espaço. */
function stripControlChars(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += (code < 32 && code !== 9 && code !== 10) || code === 127 ? ' ' : ch;
  }
  return out;
}

/**
 * Texto pronto para gravar: sem caracteres de controle, com espaços aparados e
 * cortado no limite. `singleLine` junta as linhas; `mask` esconde dados pessoais
 * (só nos textos escritos pelo modelo: a resposta da equipe pode ter o telefone do escritório).
 */
export function cleanGapText(raw: unknown, max: number, opts: { singleLine?: boolean; mask?: boolean } = {}): string {
  if (typeof raw !== 'string') return '';
  let text = stripControlChars(raw.replace(/\r\n?/g, '\n'));
  text = opts.singleLine
    ? text.replace(/\s+/g, ' ')
    : text.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  if (opts.mask) text = maskPersonalData(text);
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/** Chave de comparação da pergunta: minúsculas, sem acento, sem pontuação e com espaços únicos. */
export function gapQuestionKey(question: string): string {
  return normalizeKeyword(normalizeKeyword(question).replace(/[^a-z0-9\s]/g, ' '));
}

/** Conteúdo do trecho incluído na base: pergunta e resposta juntas, para a busca devolver as duas. */
export function learnedChunkContent(question: string, answer: string): string {
  return `Pergunta: ${question.trim()}\nResposta: ${answer.trim()}`;
}

/** Documento criado pela opção "Novo documento: Respostas aprendidas". */
export function isLearnedAnswersDocument(doc: { name: string; title?: string | null }): boolean {
  return (doc.title ?? '').trim() === LEARNED_DOCUMENT_TITLE || doc.name === LEARNED_DOCUMENT_FILE_NAME;
}

/** A pergunta voltou depois de a resposta entrar na base (a resposta pode precisar de ajuste). */
export function gapReappeared(gap: Pick<KnowledgeGapRow, 'status' | 'last_seen_at' | 'reviewed_at'>): boolean {
  if (gap.status !== 'included' || !gap.reviewed_at) return false;
  return Date.parse(gap.last_seen_at) - Date.parse(gap.reviewed_at) > GAP_REAPPEARED_AFTER_MS;
}

/** "agora", "há 5 min", "há 2 h", "há 3 dias" ou a data. */
export function formatGapAgo(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? 'há 1 dia' : `há ${days} dias`;
  return new Date(at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

const questionField = z
  .string()
  .trim()
  .min(3, 'Escreva a pergunta')
  .max(GAP_QUESTION_MAX, `A pergunta pode ter até ${GAP_QUESTION_MAX} caracteres`);
const answerField = z
  .string()
  .trim()
  .min(1, 'Escreva a resposta')
  .max(GAP_ANSWER_MAX, `A resposta pode ter até ${GAP_ANSWER_MAX} caracteres`);
const revisionFields = { expected_updated_at: z.string().datetime({ offset: true }).optional() };
const destinationFields = {
  ...revisionFields,
  question: questionField,
  answer: answerField,
  document_id: z.string().uuid().optional(),
  create_document: z.literal(true).optional(),
};

/** Ações da tela sobre uma dúvida (PATCH /knowledge-gaps/[gapId]). */
export const KnowledgeGapActionSchema = z
  .discriminatedUnion('action', [
    z.object({ action: z.literal('include'), ...destinationFields }),
    z.object({ action: z.literal('edit'), ...destinationFields }),
    z.object({ action: z.literal('remove'), ...revisionFields }),
    z.object({ action: z.literal('ignore'), ...revisionFields }),
    z.object({ action: z.literal('reopen'), ...revisionFields }),
  ])
  .superRefine((value, ctx) => {
    if ((value.action === 'include' || value.action === 'edit') && !value.document_id === !value.create_document) {
      ctx.addIssue({ code: 'custom', path: ['document_id'], message: 'Escolha um documento de destino' });
    }
  });
export type KnowledgeGapAction = z.infer<typeof KnowledgeGapActionSchema>;
