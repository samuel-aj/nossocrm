# Aprendizado com dúvidas sem resposta — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o agente de WhatsApp registra perguntas que não soube responder; o administrador responde dentro do agente e a resposta entra na base como trecho extra do documento escolhido.

**Architecture:** tabela privada `wa_ai_agent_knowledge_gaps` gravada por uma RPC atômica (agrupamento por texto e por embedding). A ferramenta `registrar_duvida_sem_resposta` usa um `reportGap` criado por execução. A inclusão grava um trecho em `wa_ai_agent_chunks` com `gap_id`, e o reprocessamento do documento mantém esses trechos. A tela é um painel novo na aba Conhecimento, alimentado por rotas `/api/wa-agents/.../knowledge-gaps`.

**Tech Stack:** Next.js 16, TypeScript 5 (alvo ES2017), Supabase Postgres + pgvector, AI SDK 6, zod 4, TanStack Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-25-aprendizado-agente-design.md`

## Regras desta execução

- Execução inline nesta sessão, autorizada por Samuel. **Sem commit**, sem aplicar a migração e sem publicar: os passos de commit viram conferência do `git status`.
- Worktree `PROJETOS/nossocrm-aprendizado`, branch `claude/aprendizado-agente` (a partir da `origin/main` 586bc6cd). Todos os comandos rodam na raiz do worktree.
- Nenhuma mensagem real, nenhuma chamada a provedor de IA: os testes simulam banco, embeddings e rede.

## Arquivos

| Arquivo | Papel |
|---|---|
| `lib/wa-agents/knowledgeGapsShared.ts` (novo) | Tipos, limites, esquema das ações e funções de texto (sem dependência de servidor) |
| `supabase/migrations/20261125120000_wa_ai_agent_knowledge_gaps.sql` (novo) | Tabela, `gap_id` nos trechos, RPC de registro |
| `lib/wa-agents/learnedAnswers.ts` (novo) | Leitura das respostas incluídas e devolução ao excluir documento |
| `lib/wa-agents/knowledgeGaps.ts` (novo) | Registro, reporter por execução, lista, ações de revisão |
| `lib/wa-agents/types.ts`, `tools.ts`, `context.ts`, `engine.ts`, `test.ts`, `knowledge.ts` | Opção, ferramenta, linha do prompt, ligação no motor e no teste, reprocessamento |
| `app/api/wa-agents/agents/[id]/knowledge-gaps/route.ts` e `[gapId]/route.ts`, `app/api/wa-agents/knowledge-gaps/summary/route.ts` (novos) | Rotas |
| `app/api/wa-agents/agents/[id]/documents/[docId]/route.ts` | Exclusão de documento devolve as respostas para Abertas |
| `features/wa-agents/useWaAgents.ts` | Hooks das dúvidas |
| `features/wa-agents/KnowledgeGapsPanel.tsx` (novo) | Painel e janela de resposta |
| `features/wa-agents/KnowledgePanel.tsx`, `AgentEditor.tsx`, `AgentList.tsx` | Encaixe do painel, opção em Recursos, contadores |

---

### Task 1: Módulo compartilhado (tipos, limites, texto, ações)

**Files:**
- Create: `lib/wa-agents/knowledgeGapsShared.ts`
- Test: `lib/wa-agents/knowledgeGapsShared.test.ts`

- [ ] **Step 1: Escrever o teste**

```ts
import { describe, expect, it } from 'vitest';
import {
  cleanGapText,
  formatGapAgo,
  gapQuestionKey,
  gapReappeared,
  isLearnedAnswersDocument,
  KnowledgeGapActionSchema,
  learnedChunkContent,
  maskPersonalData,
  MASKED_PERSONAL_DATA as M,
} from './knowledgeGapsShared';

const DOC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('maskPersonalData', () => {
  it('mascara e-mail, CNPJ, CPF e telefone e preserva o resto', () => {
    const text = 'Sou 123.456.789-09, empresa 12.345.678/0001-90, ana@exemplo.com.br, (11) 98765-4321 ou +55 21 3456-7890. Prazo de 30 dias em 2026.';
    expect(maskPersonalData(text)).toBe(`Sou ${M}, empresa ${M}, ${M}, ${M} ou ${M}. Prazo de 30 dias em 2026.`);
  });
});

describe('cleanGapText', () => {
  it('remove controles, junta espaços, corta no limite e só mascara quando pedido', () => {
    expect(cleanGapText('  Qual\u0000 o   prazo?\r\n\n\n\nSegunda linha ', 100)).toBe('Qual o prazo?\n\nSegunda linha');
    expect(cleanGapText('Linha 1\nLinha 2', 100, { singleLine: true })).toBe('Linha 1 Linha 2');
    expect(cleanGapText('abcdef', 3)).toBe('abc');
    expect(cleanGapText('Ligue (11) 98765-4321', 100)).toBe('Ligue (11) 98765-4321');
    expect(cleanGapText('Ligue (11) 98765-4321', 100, { mask: true })).toBe(`Ligue ${M}`);
    expect(cleanGapText(42 as unknown, 10)).toBe('');
  });
});

describe('textos auxiliares', () => {
  it('gapQuestionKey ignora acento, caixa e pontuação', () => {
    expect(gapQuestionKey('Qual é o PRAZO, exatamente?')).toBe('qual e o prazo exatamente');
    expect(gapQuestionKey('Ação: preço!')).toBe('acao preco');
    expect(gapQuestionKey('???')).toBe('');
  });

  it('learnedChunkContent junta pergunta e resposta', () => {
    expect(learnedChunkContent(' Qual o hotel? ', ' Hotel Mar. ')).toBe('Pergunta: Qual o hotel?\nResposta: Hotel Mar.');
  });

  it('isLearnedAnswersDocument reconhece o documento pelo título ou pelo nome', () => {
    expect(isLearnedAnswersDocument({ name: 'x.md', title: 'Respostas aprendidas' })).toBe(true);
    expect(isLearnedAnswersDocument({ name: 'Respostas aprendidas.md', title: null })).toBe(true);
    expect(isLearnedAnswersDocument({ name: 'Guia.pdf', title: 'Guia' })).toBe(false);
  });

  it('formatGapAgo fala o tempo de forma curta', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    expect(formatGapAgo('2026-11-25T11:59:40Z', now)).toBe('agora');
    expect(formatGapAgo('2026-11-25T11:55:00Z', now)).toBe('há 5 min');
    expect(formatGapAgo('2026-11-25T10:00:00Z', now)).toBe('há 2 h');
    expect(formatGapAgo('2026-11-24T12:00:00Z', now)).toBe('há 1 dia');
    expect(formatGapAgo('2026-11-20T12:00:00Z', now)).toBe('há 5 dias');
    expect(formatGapAgo('data ruim', now)).toBe('');
  });

  it('gapReappeared avisa só para resposta incluída que voltou depois de 10 minutos', () => {
    const base = { status: 'included' as const, reviewed_at: '2026-11-25T10:00:00Z' };
    expect(gapReappeared({ ...base, last_seen_at: '2026-11-25T10:05:00Z' })).toBe(false);
    expect(gapReappeared({ ...base, last_seen_at: '2026-11-25T10:20:00Z' })).toBe(true);
    expect(gapReappeared({ ...base, status: 'open', last_seen_at: '2026-11-25T10:20:00Z' })).toBe(false);
  });
});

describe('KnowledgeGapActionSchema', () => {
  const answer = { question: 'Qual o hotel?', answer: 'Hotel Mar Azul.' };
  it('aceita incluir com um destino e as ações simples', () => {
    expect(KnowledgeGapActionSchema.safeParse({ action: 'include', ...answer, document_id: DOC }).success).toBe(true);
    expect(KnowledgeGapActionSchema.safeParse({ action: 'edit', ...answer, create_document: true }).success).toBe(true);
    expect(KnowledgeGapActionSchema.safeParse({ action: 'ignore' }).success).toBe(true);
  });
  it('recusa destino ausente ou duplo, pergunta curta e ação desconhecida', () => {
    const missing = KnowledgeGapActionSchema.safeParse({ action: 'include', ...answer });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(['document_id']);
    expect(KnowledgeGapActionSchema.safeParse({ action: 'include', ...answer, document_id: DOC, create_document: true }).success).toBe(false);
    expect(KnowledgeGapActionSchema.safeParse({ action: 'include', question: 'oi', answer: 'x', document_id: DOC }).success).toBe(false);
    expect(KnowledgeGapActionSchema.safeParse({ action: 'publicar' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/wa-agents/knowledgeGapsShared.test.ts`
Expected: FAIL (módulo `./knowledgeGapsShared` não existe).

- [ ] **Step 3: Implementar**

```ts
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
const destinationFields = {
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
    z.object({ action: z.literal('remove') }),
    z.object({ action: z.literal('ignore') }),
    z.object({ action: z.literal('reopen') }),
  ])
  .superRefine((value, ctx) => {
    if ((value.action === 'include' || value.action === 'edit') && !value.document_id === !value.create_document) {
      ctx.addIssue({ code: 'custom', path: ['document_id'], message: 'Escolha um documento de destino' });
    }
  });
export type KnowledgeGapAction = z.infer<typeof KnowledgeGapActionSchema>;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/wa-agents/knowledgeGapsShared.test.ts`
Expected: PASS.

- [ ] **Step 5: Conferir** `git status --short` mostra só os dois arquivos novos (além do spec e deste plano).

---

### Task 2: Migração do banco

**Files:**
- Create: `supabase/migrations/20261125120000_wa_ai_agent_knowledge_gaps.sql`
- Test: `lib/wa-agents/knowledgeGapsMigration.test.ts`

- [ ] **Step 1: Escrever o teste** (protege as regras de acesso do arquivo)

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261125120000_wa_ai_agent_knowledge_gaps.sql'), 'utf8');

describe('migração das dúvidas sem resposta', () => {
  it('cria a tabela privada, acessível só pelo servidor', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.wa_ai_agent_knowledge_gaps/);
    expect(sql).toMatch(/ALTER TABLE public\.wa_ai_agent_knowledge_gaps ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.wa_ai_agent_knowledge_gaps FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.wa_ai_agent_knowledge_gaps TO service_role/);
  });

  it('a RPC roda como definidor com search_path fixo, trava por agente e só o servidor executa', () => {
    expect(sql).toMatch(/FUNCTION public\.wa_ai_record_knowledge_gap\([\s\S]*?SECURITY DEFINER SET search_path = public/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.wa_ai_record_knowledge_gap\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.wa_ai_record_knowledge_gap\([^)]*\) TO service_role/);
  });

  it('liga os trechos às dúvidas e apaga o trecho junto com a dúvida', () => {
    expect(sql).toMatch(/ALTER TABLE public\.wa_ai_agent_chunks ADD COLUMN IF NOT EXISTS gap_id uuid REFERENCES public\.wa_ai_agent_knowledge_gaps\(id\) ON DELETE CASCADE/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/wa-agents/knowledgeGapsMigration.test.ts`
Expected: FAIL (ENOENT, arquivo não existe).

- [ ] **Step 3: Escrever a migração**

```sql
-- =============================================================================
-- Agentes de IA: dúvidas sem resposta (aprendizado). Tudo aditivo.
-- O agente registra a pergunta que não achou no roteiro nem na base (ferramenta
-- registrar_duvida_sem_resposta); o administrador responde e a resposta vira um
-- trecho extra do documento escolhido (wa_ai_agent_chunks.gap_id).
-- Acesso só pelo servidor (service_role).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.wa_ai_agent_knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ignored', 'included')),
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 300),
  question_key text NOT NULL,
  question_embedding vector(1536),
  embedding_model text,
  context text CHECK (context IS NULL OR char_length(context) <= 800),
  suggested_answer text CHECK (suggested_answer IS NULL OR char_length(suggested_answer) <= 2000),
  answer text CHECK (answer IS NULL OR char_length(answer) <= 4000),
  document_id uuid REFERENCES public.wa_ai_agent_documents(id) ON DELETE SET NULL,
  suggested_document_id uuid REFERENCES public.wa_ai_agent_documents(id) ON DELETE SET NULL,
  occurrences integer NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  test_only boolean NOT NULL DEFAULT false,
  last_source_key text,
  last_conversation_id uuid REFERENCES public.wa_conversations(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_ai_agent_knowledge_gaps_included_answer CHECK (status <> 'included' OR answer IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS wa_ai_agent_knowledge_gaps_list_idx
  ON public.wa_ai_agent_knowledge_gaps (organization_id, agent_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS wa_ai_agent_knowledge_gaps_key_idx
  ON public.wa_ai_agent_knowledge_gaps (agent_id, question_key);
CREATE INDEX IF NOT EXISTS wa_ai_agent_knowledge_gaps_document_idx
  ON public.wa_ai_agent_knowledge_gaps (document_id) WHERE document_id IS NOT NULL;

ALTER TABLE public.wa_ai_agent_knowledge_gaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_ai_agent_knowledge_gaps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_ai_agent_knowledge_gaps TO service_role;

-- Resposta incluída = trecho extra do documento, apagado junto com a dúvida
ALTER TABLE public.wa_ai_agent_chunks ADD COLUMN IF NOT EXISTS gap_id uuid REFERENCES public.wa_ai_agent_knowledge_gaps(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS wa_ai_agent_chunks_gap_idx ON public.wa_ai_agent_chunks (gap_id) WHERE gap_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Registro atômico: soma uma ocorrência à dúvida de mesmo texto ou de mesmo
-- sentido (embedding acima do limite, no mesmo modelo) ou cria uma dúvida aberta.
-- A mesma origem (conversa ou sessão de teste) conta uma vez a cada 24 h.
-- Devolve vazio quando o agente já tem p_open_limit dúvidas abertas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_record_knowledge_gap(
  p_org uuid,
  p_agent uuid,
  p_question text,
  p_question_key text,
  p_embedding vector(1536),
  p_model text,
  p_threshold double precision,
  p_context text,
  p_suggested_answer text,
  p_suggested_document uuid,
  p_source_key text,
  p_conversation uuid,
  p_test boolean,
  p_open_limit integer DEFAULT 200
)
RETURNS TABLE (gap_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match uuid;
  v_document uuid;
  v_conversation uuid;
  v_open integer;
  v_id uuid;
BEGIN
  IF p_org IS NULL OR p_agent IS NULL OR COALESCE(btrim(p_question), '') = '' OR COALESCE(p_question_key, '') = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_ai_agents a WHERE a.id = p_agent AND a.organization_id = p_org) THEN
    RETURN;
  END IF;

  -- Uma gravação por vez por agente: duas perguntas iguais ao mesmo tempo não viram duas linhas
  PERFORM pg_advisory_xact_lock(hashtextextended('wa_ai_knowledge_gap:' || p_agent::text, 0));

  -- Só referências do mesmo agente e da mesma organização
  SELECT d.id INTO v_document FROM public.wa_ai_agent_documents d
   WHERE d.id = p_suggested_document AND d.organization_id = p_org AND d.agent_id = p_agent;
  SELECT c.id INTO v_conversation FROM public.wa_conversations c
   WHERE c.id = p_conversation AND c.organization_id = p_org;

  SELECT g.id INTO v_match FROM public.wa_ai_agent_knowledge_gaps g
   WHERE g.organization_id = p_org AND g.agent_id = p_agent AND g.question_key = p_question_key
   ORDER BY g.last_seen_at DESC
   LIMIT 1;

  IF v_match IS NULL AND p_embedding IS NOT NULL AND p_model IS NOT NULL AND p_threshold IS NOT NULL THEN
    SELECT g.id INTO v_match FROM public.wa_ai_agent_knowledge_gaps g
     WHERE g.organization_id = p_org AND g.agent_id = p_agent
       AND g.question_embedding IS NOT NULL AND g.embedding_model = p_model
       AND 1 - (g.question_embedding <=> p_embedding) >= p_threshold
     ORDER BY g.question_embedding <=> p_embedding
     LIMIT 1;
  END IF;

  IF v_match IS NOT NULL THEN
    UPDATE public.wa_ai_agent_knowledge_gaps g SET
      occurrences = g.occurrences + CASE
        WHEN g.last_source_key IS DISTINCT FROM p_source_key OR g.last_seen_at < now() - interval '24 hours' THEN 1
        ELSE 0
      END,
      last_seen_at = now(),
      last_source_key = p_source_key,
      last_conversation_id = COALESCE(v_conversation, g.last_conversation_id),
      test_only = g.test_only AND COALESCE(p_test, false),
      suggested_document_id = COALESCE(v_document, g.suggested_document_id),
      context = COALESCE(left(p_context, 800), g.context),
      suggested_answer = COALESCE(left(p_suggested_answer, 2000), g.suggested_answer),
      updated_at = now()
    WHERE g.id = v_match;
    RETURN QUERY SELECT v_match, false;
    RETURN;
  END IF;

  SELECT count(*) INTO v_open FROM public.wa_ai_agent_knowledge_gaps g
   WHERE g.organization_id = p_org AND g.agent_id = p_agent AND g.status = 'open';
  IF v_open >= GREATEST(COALESCE(p_open_limit, 200), 1) THEN
    RETURN;
  END IF;

  INSERT INTO public.wa_ai_agent_knowledge_gaps AS g (
    organization_id, agent_id, question, question_key, question_embedding, embedding_model,
    context, suggested_answer, suggested_document_id, last_source_key, last_conversation_id, test_only
  ) VALUES (
    p_org, p_agent, left(btrim(p_question), 300), p_question_key, p_embedding,
    CASE WHEN p_embedding IS NULL THEN NULL ELSE p_model END,
    left(p_context, 800), left(p_suggested_answer, 2000), v_document, p_source_key, v_conversation, COALESCE(p_test, false)
  )
  RETURNING g.id INTO v_id;
  RETURN QUERY SELECT v_id, true;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_ai_record_knowledge_gap(uuid, uuid, text, text, vector, text, double precision, text, text, uuid, text, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_record_knowledge_gap(uuid, uuid, text, text, vector, text, double precision, text, text, uuid, text, uuid, boolean, integer) TO service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/wa-agents/knowledgeGapsMigration.test.ts`
Expected: PASS. (O SQL não roda localmente: não há Supabase nesta máquina. Fica para a revisão e para a aplicação em homologação.)

- [ ] **Step 5: Conferir** `git status --short`.

---

### Task 3: Opção no agente, ferramenta e linha do prompt

**Files:**
- Modify: `lib/wa-agents/types.ts` (`AgentToolsSchema`)
- Modify: `lib/wa-agents/tools.ts`
- Modify: `lib/wa-agents/context.ts`
- Test: `lib/wa-agents/tools.test.ts` (novo `describe`), `lib/wa-agents/knowledgeGapsPrompt.test.ts` (novo)

- [ ] **Step 1: Escrever os testes**

Acrescentar ao fim de `lib/wa-agents/tools.test.ts`:

```ts
describe('registrar_duvida_sem_resposta', () => {
  const on = () => agent({ tools: { calculator: true, knowledge_gaps: true } });

  it('só aparece com a opção ligada e o executor, nunca nas ferramentas dos auxiliares', () => {
    const reportGap = async () => ({ ok: true });
    expect(buildAgentTools(on(), { reportGap })).toHaveProperty('registrar_duvida_sem_resposta');
    expect(buildAgentTools(on())).not.toHaveProperty('registrar_duvida_sem_resposta');
    expect(buildAgentTools(agent(), { reportGap })).not.toHaveProperty('registrar_duvida_sem_resposta');
    expect(buildUtilityTools(on(), { reportGap })).not.toHaveProperty('registrar_duvida_sem_resposta');
  });

  it('repassa a entrada ao executor e transforma erro em resposta sem lançar', async () => {
    const calls: unknown[] = [];
    const tools = buildAgentTools(on(), {
      reportGap: async input => {
        calls.push(input);
        return { ok: true, registrada: true };
      },
    });
    const exec = tools.registrar_duvida_sem_resposta!.execute as (input: unknown, opts: unknown) => Promise<unknown>;
    const input = { pergunta: 'Qual é o hotel do pacote?', o_que_falta: 'A base não cita o nome.' };
    expect(await exec(input, {})).toEqual({ ok: true, registrada: true });
    expect(calls).toEqual([input]);

    const failing = buildAgentTools(on(), {
      reportGap: async () => {
        throw new Error('banco fora do ar');
      },
    });
    const execFail = failing.registrar_duvida_sem_resposta!.execute as (input: unknown, opts: unknown) => Promise<unknown>;
    expect(await execFail({ pergunta: 'Qual o hotel?' }, {})).toEqual({ ok: false, erro: 'banco fora do ar' });
  });
});
```

Criar `lib/wa-agents/knowledgeGapsPrompt.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { buildSystemPrompt, KNOWLEDGE_GAP_PROMPT_LINE, normalizeAgentRow } from './context';
import { buildTestContext } from './test';

function prompt(tools: Record<string, unknown>, knowledgeGaps: boolean): string {
  const agent = normalizeAgentRow({ id: 'agent', organization_id: 'org', system_prompt: 'Atenda o cliente.', tools });
  const ctx = buildTestContext({ organizationId: 'org', organizationName: 'Teste', agent });
  return buildSystemPrompt({ agent, ctx, knowledgeGaps });
}

describe('linha de dúvidas sem resposta no prompt', () => {
  it('entra só com a opção ligada no agente e a ferramenta disponível na geração', () => {
    expect(prompt({ calculator: true, knowledge_gaps: true }, true)).toContain(KNOWLEDGE_GAP_PROMPT_LINE);
    expect(prompt({ calculator: true, knowledge_gaps: true }, false)).not.toContain('registrar_duvida_sem_resposta');
    expect(prompt({ calculator: true }, true)).not.toContain('registrar_duvida_sem_resposta');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/wa-agents/tools.test.ts lib/wa-agents/knowledgeGapsPrompt.test.ts`
Expected: FAIL (ferramenta ausente; `KNOWLEDGE_GAP_PROMPT_LINE` não exportado).

- [ ] **Step 3: Implementar**

Em `lib/wa-agents/types.ts`, dentro de `AgentToolsSchema`, depois de `zapsign_signed_message_template`:

```ts
  /** Ferramenta registrar_duvida_sem_resposta (aprender com dúvidas sem resposta); ausente = desligada */
  knowledge_gaps: z.boolean().optional(),
```

Em `lib/wa-agents/tools.ts`:

1. Imports, depois de `import { formatKnowledgeHits } from './knowledge';`:

```ts
import { GAP_TOOL_INPUT_MAX, type GapReportInput } from './knowledgeGapsShared';
```

2. Em `AgentToolRuntime`, depois de `consultHelper?`:

```ts
  /** Dúvida sem resposta: liga registrar_duvida_sem_resposta (com a opção ligada no agente) */
  reportGap?: (input: GapReportInput) => Promise<unknown>;
```

3. Antes de `function createDocumentLookup`:

```ts
/** Ferramenta da opção "Aprender com dúvidas sem resposta". */
export const KNOWLEDGE_GAP_TOOL = 'registrar_duvida_sem_resposta';
const KNOWLEDGE_GAP_TOOL_DESCRIPTION =
  'Registra para a equipe uma dúvida do cliente que você não conseguiu responder com o roteiro nem com a base de conhecimento (consulte a base antes, quando houver). Chame uma vez por dúvida, com a pergunta escrita de forma genérica e sem dados do cliente. Isso só avisa a equipe e não muda a sua resposta: responda ao cliente como o roteiro orienta para dúvidas sem resposta e não invente a informação.';
```

4. Em `buildAgentTools`, logo depois de `Object.assign(tools, buildUtilityTools(agent, runtime, reservedDocuments));`:

```ts
  if (agent.tools?.knowledge_gaps && runtime.reportGap) {
    const report = runtime.reportGap;
    tools[KNOWLEDGE_GAP_TOOL] = tool({
      description: KNOWLEDGE_GAP_TOOL_DESCRIPTION,
      inputSchema: z.object({
        pergunta: z
          .string()
          .max(GAP_TOOL_INPUT_MAX)
          .describe('A dúvida do cliente escrita como pergunta genérica de FAQ, sem nome, telefone, CPF, valores ou outros dados do cliente. Ex.: "Qual é o prazo para receber o primeiro pagamento do auxílio?"'),
        o_que_falta: z.string().max(GAP_TOOL_INPUT_MAX).optional().describe('O que a base já diz sobre o assunto e o que faltou para responder'),
        resposta_sugerida: z
          .string()
          .max(GAP_TOOL_INPUT_MAX)
          .optional()
          .describe('Rascunho de resposta só com o que a base já diz, quando houver informação parcial. Deixe vazio se não houver'),
      }),
      execute: async input => {
        try {
          return await report(input);
        } catch (e) {
          return { ok: false, erro: errorMessage(e) };
        }
      },
    });
  }
```

Em `lib/wa-agents/context.ts`:

1. Logo antes de `export function buildSystemPrompt(input: {`:

```ts
/** Linha do prompt com a opção "Aprender com dúvidas sem resposta" ligada (ferramenta registrar_duvida_sem_resposta). */
export const KNOWLEDGE_GAP_PROMPT_LINE =
  '- Dúvidas sem resposta: quando a resposta não estiver no roteiro nem na base de conhecimento (consulte a base antes, quando houver), chame registrar_duvida_sem_resposta uma vez por dúvida, com a pergunta escrita de forma genérica e sem dados do cliente. Isso só avisa a equipe: responda ao cliente como o roteiro orienta para dúvidas sem resposta e não invente a informação.';
```

2. No tipo de entrada de `buildSystemPrompt`, depois de `followup?: { instruction: string; silentFor: string } | null;`:

```ts
  /** Ferramenta registrar_duvida_sem_resposta disponível nesta geração (motor e teste) */
  knowledgeGaps?: boolean;
```

3. Logo antes de `  if (mediaBlock) {` (o bloco que empurra a linha "- Mídias: ..."):

```ts
  if (input.knowledgeGaps && agent.tools?.knowledge_gaps) lines.push(KNOWLEDGE_GAP_PROMPT_LINE);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/wa-agents/tools.test.ts lib/wa-agents/knowledgeGapsPrompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Conferir** `git status --short`.

---

### Task 4: Registro da dúvida e reporter por execução

**Files:**
- Modify: `lib/wa-agents/knowledge.ts` (exportar `agentEmbeddingProfile`)
- Create: `lib/wa-agents/knowledgeGaps.ts`
- Test: `lib/wa-agents/knowledgeGaps.test.ts`

- [ ] **Step 1: Escrever o teste**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/wa-agents/knowledgeGaps.test.ts`
Expected: FAIL (módulo `./knowledgeGaps` não existe).

- [ ] **Step 3: Implementar**

Em `lib/wa-agents/knowledge.ts`, trocar `async function agentEmbeddingProfile(` por `export async function agentEmbeddingProfile(`.

Criar `lib/wa-agents/knowledgeGaps.ts`:

```ts
/**
 * Dúvidas sem resposta (aprendizado do agente). SERVER.
 *
 * Registro: a ferramenta registrar_duvida_sem_resposta chama `reportGap`
 * (createGapReporter); o texto é saneado, a pergunta ganha embedding e a RPC
 * wa_ai_record_knowledge_gap grava agrupando perguntas de mesmo sentido.
 * Revisão: a resposta aprovada vira um trecho extra (gap_id) do documento
 * escolhido, sem alterar o arquivo original.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage } from './errors';
import { agentEmbeddingProfile, embedTexts, MIN_SIMILARITY, type EmbeddingProvider } from './knowledge';
import {
  cleanGapText,
  gapQuestionKey,
  GAP_CONTEXT_MAX,
  GAP_MAX_REPORTS_PER_RUN,
  GAP_OPEN_LIMIT,
  GAP_QUESTION_MAX,
  GAP_SUGGESTED_MAX,
  type GapReportInput,
} from './knowledgeGapsShared';

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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/wa-agents/knowledgeGaps.test.ts`
Expected: PASS.

- [ ] **Step 5: Conferir** `git status --short`.

---

### Task 5: Ligar a ferramenta no motor e no chat de teste

**Files:**
- Modify: `lib/wa-agents/engine.ts`
- Modify: `lib/wa-agents/test.ts`

- [ ] **Step 1: Motor** — em `lib/wa-agents/engine.ts`:

1. Import, ao lado dos outros imports locais:

```ts
import { createGapReporter } from './knowledgeGaps';
```

2. Na chamada `let system = buildSystemPrompt({ ... })`, acrescentar a propriedade:

```ts
      knowledgeGaps: !!agent.tools?.knowledge_gaps,
```

3. No objeto `const runtime: AgentToolRuntime = {`, logo depois de `helpers: resources.helpers,`:

```ts
      ...(runAgent.tools?.knowledge_gaps ? {
        reportGap: createGapReporter(admin, {
          organizationId,
          agentId: runAgent.id,
          source: { kind: 'conversation', conversationId },
          onEvent: pushEvent,
        }),
      } : {}),
```

- [ ] **Step 2: Chat de teste** — em `lib/wa-agents/test.ts`:

1. Import:

```ts
import { createGapReporter } from './knowledgeGaps';
```

2. Trocar `const system = buildSystemPrompt({ agent, ctx, resources, knowledge }) +` por:

```ts
  const system = buildSystemPrompt({ agent, ctx, resources, knowledge, knowledgeGaps: !!agent.tools?.knowledge_gaps }) +
```

3. No `const runtime: AgentToolRuntime = {`, logo depois de `helpers: resources.helpers,`:

```ts
    ...(agent.tools?.knowledge_gaps ? {
      reportGap: createGapReporter(admin, {
        organizationId,
        agentId: agent.id,
        source: { kind: 'test', sessionId: input.session?.id ?? null },
      }),
    } : {}),
```

- [ ] **Step 3: Conferir tipos e os testes existentes do motor e do teste**

Run: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run lib/wa-agents`
Expected: sem erros de tipo; todos os testes de `lib/wa-agents` passam.

- [ ] **Step 4: Conferir** `git status --short`.

---

### Task 6: Respostas aprendidas no reprocessamento e na exclusão do documento

**Files:**
- Create: `lib/wa-agents/learnedAnswers.ts`
- Modify: `lib/wa-agents/knowledge.ts` (`processDocumentWithUsage`)
- Modify: `app/api/wa-agents/agents/[id]/documents/[docId]/route.ts` (`DELETE`)
- Test: `lib/wa-agents/learnedAnswers.test.ts`, `lib/wa-agents/knowledge.learned.test.ts`

- [ ] **Step 1: Escrever os testes**

`lib/wa-agents/learnedAnswers.test.ts`:

```ts
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
  const client = { from: (table: string) => { calls.push(['from', table]); return query; } };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('respostas aprendidas', () => {
  it('lê só as respostas incluídas do documento, no formato do trecho', async () => {
    const { client, calls } = db({ data: [{ id: 'g1', question: 'Qual o hotel?', answer: 'Hotel Mar.' }, { id: 'g2', question: 'Sem resposta', answer: ' ' }], error: null });
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
```

`lib/wa-agents/knowledge.learned.test.ts`:

```ts
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
    query.update = (patch: Record<string, unknown>) => { action = 'update'; updates.push(patch); return query; };
    query.delete = () => { action = 'delete'; return query; };
    query.insert = async (rows: Array<Record<string, unknown>>) => { inserted.push(...rows); return { error: null }; };
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/wa-agents/learnedAnswers.test.ts lib/wa-agents/knowledge.learned.test.ts`
Expected: FAIL (módulo `./learnedAnswers` não existe).

- [ ] **Step 3: Implementar**

`lib/wa-agents/learnedAnswers.ts`:

```ts
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
```

Em `lib/wa-agents/knowledge.ts`:

1. Import: `import { LEARNED_CHUNK_IDX_BASE, loadLearnedAnswers } from './learnedAnswers';`
2. Em `processDocumentWithUsage`, substituir o trecho que vai de `// Teto de trechos por agente` até o `return { ok: true, chunkCount: chunks.length, embedded: !!embedded };` por:

```ts
    // Respostas aprendidas incluídas neste documento continuam como trechos extras
    const learned = await loadLearnedAnswers(admin, doc.organization_id, doc.id);
    const total = chunks.length + learned.length;

    // Teto de trechos por agente (somando os outros documentos prontos)
    const profile = await agentEmbeddingProfile(admin, doc.organization_id, doc.agent_id, { exceptDocumentId: doc.id });
    if (profile.chunks + total > AGENT_CHUNKS_MAX_PER_AGENT) {
      throw new Error(
        `Limite de ${AGENT_CHUNKS_MAX_PER_AGENT} trechos por agente ultrapassado (este documento tem ${total}; os demais somam ${profile.chunks}). Remova documentos ou envie um arquivo menor.`
      );
    }

    remaining('embeddings');
    // Vetoriza cabeçalho + trecho (o conteúdo gravado continua só o trecho)
    const header = documentHeader(doc);
    const contents = [...chunks, ...learned.map(item => item.content)];
    const toEmbed = contents.map(c => `${header}\n${c}`);
    let embedded: EmbedTextsResult | null = null;
    try {
      embedded = await embedTexts(admin, doc.organization_id, toEmbed, { prefer: profile.model, abortSignal: abort });
    } catch (e) {
      // Sem embedding o documento continua útil pela busca por texto
      assertUsageHealthy();
      console.error('[wa-agents] embeddings falharam, seguindo só com busca por texto:', errorMessage(e));
      embedded = null;
    }

    remaining('gravação');
    await deleteDocumentChunks(admin, doc.organization_id, doc.id);
    const rows = contents.map((content, k) => ({
      organization_id: doc.organization_id,
      agent_id: doc.agent_id,
      document_id: doc.id,
      idx: k < chunks.length ? k : LEARNED_CHUNK_IDX_BASE + (k - chunks.length),
      content,
      embedding: embedded ? embedded.embeddings[k] : null,
      embedding_model: embedded ? embedded.model : null,
      // gap_id só nas respostas aprendidas (antes da migração a coluna não existe)
      ...(k >= chunks.length ? { gap_id: learned[k - chunks.length].gapId } : {}),
    }));
    for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH) {
      const { error } = await admin.from('wa_ai_agent_chunks').insert(rows.slice(i, i + CHUNK_INSERT_BATCH));
      if (error) throw new Error(`Falha ao gravar os trechos: ${error.message}`);
    }

    await setDocumentStatus(admin, doc, {
      status: 'ready',
      error: null,
      chunk_count: total,
      embedding_model: embedded ? embedded.model : null,
    });
    return { ok: true, chunkCount: total, embedded: !!embedded };
```

Em `app/api/wa-agents/agents/[id]/documents/[docId]/route.ts`:

1. Import: `import { reopenGapsForDocument } from '@/lib/wa-agents/learnedAnswers';`
2. No `DELETE`, trocar o bloco `try { await deleteDocumentChunks(...) } catch` por:

```ts
  try {
    // Respostas aprendidas deste documento voltam para "Dúvidas sem resposta" (com o texto guardado)
    await reopenGapsForDocument(auth.admin, orgId, document.id);
    await deleteDocumentChunks(auth.admin, orgId, document.id);
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao apagar os trechos do documento') }, 500);
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/wa-agents/learnedAnswers.test.ts lib/wa-agents/knowledge.learned.test.ts lib/wa-agents/knowledge.test.ts`
Expected: PASS.

- [ ] **Step 5: Conferir** `git status --short`.

---

### Task 7: Lista e ações de revisão

**Files:**
- Modify: `lib/wa-agents/knowledgeGaps.ts`
- Test: `lib/wa-agents/knowledgeGaps.review.test.ts`

- [ ] **Step 1: Escrever o teste**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/wa-agents/knowledgeGaps.review.test.ts`
Expected: FAIL (`applyKnowledgeGapAction` e demais não exportados).

- [ ] **Step 3: Implementar**

Em `lib/wa-agents/knowledgeGaps.ts`, substituir o bloco de imports do topo por:

```ts
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
```

E acrescentar ao fim do arquivo:

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/wa-agents/knowledgeGaps.review.test.ts lib/wa-agents/knowledgeGaps.test.ts`
Expected: PASS.

- [ ] **Step 5: Conferir** `git status --short`.

---

### Task 8: Rotas da API

**Files:**
- Create: `app/api/wa-agents/agents/[id]/knowledge-gaps/route.ts`
- Create: `app/api/wa-agents/agents/[id]/knowledge-gaps/[gapId]/route.ts`
- Create: `app/api/wa-agents/knowledge-gaps/summary/route.ts`
- Test: `app/api/wa-agents/agents/[id]/knowledge-gaps/[gapId]/route.test.ts`, `app/api/wa-agents/agents/[id]/knowledge-gaps/route.test.ts`

- [ ] **Step 1: Escrever os testes**

`app/api/wa-agents/agents/[id]/knowledge-gaps/[gapId]/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ denied: false, belongs: true, guard: vi.fn(), apply: vi.fn(), remove: vi.fn() }));

vi.mock('../../../../_shared', async importOriginal => ({
  ...await importOriginal<object>(),
  guardRoute: async (options: unknown) => {
    h.guard(options);
    if (h.denied) return { ok: false, response: new Response('Forbidden', { status: 403 }) };
    return { ok: true, user: { id: 'admin-user', organizationId: 'org' }, admin: {}, isAdmin: true };
  },
  agentBelongsToOrg: async () => h.belongs,
}));
vi.mock('@/lib/wa-agents/knowledgeGaps', async importOriginal => ({
  ...await importOriginal<object>(),
  applyKnowledgeGapAction: h.apply,
  deleteKnowledgeGap: h.remove,
}));

import { DELETE, PATCH } from './route';
import { KnowledgeGapError } from '@/lib/wa-agents/knowledgeGaps';

const agentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const gapId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const docId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const url = `http://localhost/api/wa-agents/agents/${agentId}/knowledge-gaps/${gapId}`;
const ctx = () => ({ params: Promise.resolve({ id: agentId, gapId }) });
const patch = (body: unknown) =>
  PATCH(new Request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx());
const include = { action: 'include', question: 'Qual o hotel?', answer: 'Mar Azul', document_id: docId };

beforeEach(() => {
  h.denied = false;
  h.belongs = true;
  h.guard.mockClear();
  h.apply.mockReset();
  h.remove.mockReset();
});

describe('PATCH /knowledge-gaps/[gapId]', () => {
  it('exige administrador com agente liberado e confere a origem', async () => {
    h.denied = true;
    expect((await patch({ action: 'ignore' })).status).toBe(403);
    expect(h.guard).toHaveBeenCalledWith(expect.objectContaining({ admin: true, agents: true, req: expect.any(Request) }));
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('recusa inclusão sem documento de destino', async () => {
    expect((await patch({ action: 'include', question: 'Qual o hotel?', answer: 'Mar Azul' })).status).toBe(400);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('não mexe em dúvida de agente de outra organização', async () => {
    h.belongs = false;
    expect((await patch({ action: 'ignore' })).status).toBe(404);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('repassa a ação com o usuário e devolve a dúvida', async () => {
    h.apply.mockResolvedValue({ id: gapId, status: 'included' });
    const res = await patch(include);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gap: { id: gapId, status: 'included' } });
    expect(h.apply).toHaveBeenCalledWith({}, { organizationId: 'org', agentId, gapId, userId: 'admin-user', action: include });
  });

  it('transforma o erro da regra em status e mensagem', async () => {
    h.apply.mockRejectedValue(new KnowledgeGapError('DOCUMENT_NOT_READY', 'O documento está sendo processado. Tente de novo em instantes.', 409));
    const res = await patch(include);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'O documento está sendo processado. Tente de novo em instantes.', code: 'DOCUMENT_NOT_READY' });
  });
});

describe('DELETE /knowledge-gaps/[gapId]', () => {
  it('exclui a dúvida do agente', async () => {
    h.remove.mockResolvedValue(undefined);
    const res = await DELETE(new Request(url, { method: 'DELETE' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.remove).toHaveBeenCalledWith({}, { organizationId: 'org', agentId, gapId });
  });
});
```

`app/api/wa-agents/agents/[id]/knowledge-gaps/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ guard: vi.fn(), list: vi.fn() }));

vi.mock('../../../_shared', async importOriginal => ({
  ...await importOriginal<object>(),
  guardRoute: async (options: unknown) => {
    h.guard(options);
    return { ok: true, user: { id: 'admin-user', organizationId: 'org' }, admin: {}, isAdmin: true };
  },
  agentBelongsToOrg: async () => true,
}));
vi.mock('@/lib/wa-agents/knowledgeGaps', async importOriginal => ({ ...await importOriginal<object>(), listKnowledgeGaps: h.list }));

import { GET } from './route';

const agentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const get = (query: string) =>
  GET(new Request(`http://localhost/api/wa-agents/agents/${agentId}/knowledge-gaps${query}`), { params: Promise.resolve({ id: agentId }) });

beforeEach(() => {
  h.guard.mockClear();
  h.list.mockReset();
});

describe('GET /knowledge-gaps', () => {
  it('lista as abertas por padrão, só para administrador com agente liberado', async () => {
    const result = { gaps: [], counts: { open: 0, included: 0, ignored: 0 }, learned_by_document: {} };
    h.list.mockResolvedValue(result);
    const res = await get('');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(h.list).toHaveBeenCalledWith({}, 'org', agentId, 'open');
    expect(h.guard).toHaveBeenCalledWith(expect.objectContaining({ admin: true, agents: true }));
  });

  it('recusa status desconhecido', async () => {
    expect((await get('?status=todas')).status).toBe(400);
    expect(h.list).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "app/api/wa-agents/agents/[id]/knowledge-gaps"`
Expected: FAIL (rotas não existem).

- [ ] **Step 3: Implementar**

`app/api/wa-agents/agents/[id]/knowledge-gaps/route.ts`:

```ts
/**
 * /api/wa-agents/agents/[id]/knowledge-gaps  (admin + beta)
 *   GET ?status=open|included|ignored -> { gaps, counts, learned_by_document }
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { listKnowledgeGaps } from '@/lib/wa-agents/knowledgeGaps';
import { KNOWLEDGE_GAP_STATUSES, type KnowledgeGapStatus } from '@/lib/wa-agents/knowledgeGapsShared';
import { agentBelongsToOrg, agentNotFoundError, getErrorMessage, guardRoute } from '../../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ admin: true, agents: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const status = new URL(req.url).searchParams.get('status') ?? 'open';
  if (!(KNOWLEDGE_GAP_STATUSES as readonly string[]).includes(status)) return json({ error: 'Status inválido' }, 400);
  const orgId = auth.user.organizationId;
  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    return json(await listKnowledgeGaps(auth.admin, orgId, id, status as KnowledgeGapStatus));
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao listar as dúvidas') }, 500);
  }
}
```

`app/api/wa-agents/agents/[id]/knowledge-gaps/[gapId]/route.ts`:

```ts
/**
 * /api/wa-agents/agents/[id]/knowledge-gaps/[gapId]  (admin + beta)
 *   PATCH  -> { gap }  KnowledgeGapActionSchema: include | edit (com document_id ou
 *            create_document) | remove | ignore | reopen
 *   DELETE -> { ok: true }  só dúvida aberta ou ignorada
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { applyKnowledgeGapAction, deleteKnowledgeGap, KnowledgeGapError } from '@/lib/wa-agents/knowledgeGaps';
import { KnowledgeGapActionSchema } from '@/lib/wa-agents/knowledgeGapsShared';
import { agentBelongsToOrg, agentNotFoundError, getErrorMessage, guardRoute, readJsonBody, validationError } from '../../../../_shared';

export const runtime = 'nodejs';
/** Criar o documento "Respostas aprendidas" processa o arquivo na mesma chamada. */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string; gapId: string }> };

function failure(err: unknown, fallback: string): Response {
  if (err instanceof KnowledgeGapError) return json({ error: err.message, code: err.code }, err.status);
  return json({ error: getErrorMessage(err, fallback) }, 500);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true, agents: true });
  if (!auth.ok) return auth.response;
  const { id, gapId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(gapId)) return json({ error: 'ID inválido' }, 400);
  const parsed = KnowledgeGapActionSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const orgId = auth.user.organizationId;
  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    const gap = await applyKnowledgeGapAction(auth.admin, {
      organizationId: orgId,
      agentId: id,
      gapId,
      userId: auth.user.id,
      action: parsed.data,
    });
    return json({ gap });
  } catch (err) {
    return failure(err, 'Falha ao atualizar a dúvida');
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true, agents: true });
  if (!auth.ok) return auth.response;
  const { id, gapId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(gapId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;
  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    await deleteKnowledgeGap(auth.admin, { organizationId: orgId, agentId: id, gapId });
    return json({ ok: true });
  } catch (err) {
    return failure(err, 'Falha ao excluir a dúvida');
  }
}
```

`app/api/wa-agents/knowledge-gaps/summary/route.ts`:

```ts
/**
 * /api/wa-agents/knowledge-gaps/summary  (admin + beta)
 *   GET -> { counts: { [agentId]: dúvidas abertas } }
 */
import { json } from '@/lib/whatsapp/api';
import { openGapCountsByAgent } from '@/lib/wa-agents/knowledgeGaps';
import { getErrorMessage, guardRoute } from '../../_shared';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await guardRoute({ admin: true, agents: true });
  if (!auth.ok) return auth.response;
  try {
    return json({ counts: await openGapCountsByAgent(auth.admin, auth.user.organizationId) });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao contar as dúvidas') }, 500);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "app/api/wa-agents/agents/[id]/knowledge-gaps"`
Expected: PASS.

- [ ] **Step 5: Conferir** `git status --short`.

---

### Task 9: Hooks de dados

**Files:**
- Modify: `features/wa-agents/useWaAgents.ts`

- [ ] **Step 1: Implementar** (coberto pelo teste do painel na Task 10)

1. Import de tipos, depois do import de `@/lib/wa-agents/types`:

```ts
import type { KnowledgeGapAction, KnowledgeGapListResult, KnowledgeGapRow, KnowledgeGapStatus } from '@/lib/wa-agents/knowledgeGapsShared';
```

2. Depois de `const mediaKey = ...`:

```ts
const gapsKey = (agentId: string | null | undefined, status?: KnowledgeGapStatus) =>
  status ? [WA_AGENTS_QUERY_KEY, 'gaps', agentId ?? '', status] : [WA_AGENTS_QUERY_KEY, 'gaps', agentId ?? ''];
const GAP_SUMMARY_KEY = [WA_AGENTS_QUERY_KEY, 'gapSummary'];
```

3. Em `useDeleteWaAgentDocument`, no `onSuccess`, depois da invalidação dos documentos (as respostas do documento excluído voltam para Abertas):

```ts
      void qc.invalidateQueries({ queryKey: gapsKey(agentId) });
      void qc.invalidateQueries({ queryKey: GAP_SUMMARY_KEY });
```

4. Depois de `useReprocessWaAgentDocument`:

```ts
// ---------------------------------------------------------------- Dúvidas sem resposta

/** Dúvidas de um status do agente, com os totais e as respostas por documento. */
export function useWaAgentKnowledgeGaps(agentId: string | null | undefined, status: KnowledgeGapStatus) {
  return useQuery({
    queryKey: gapsKey(agentId, status),
    queryFn: () => waAgentsFetch<KnowledgeGapListResult>(`/api/wa-agents/agents/${agentId}/knowledge-gaps${toQuery({ status })}`),
    enabled: !!agentId,
  });
}

/** Dúvidas abertas por agente (etiqueta na lista de agentes). */
export function useWaKnowledgeGapSummary(enabled = true) {
  return useQuery({
    queryKey: GAP_SUMMARY_KEY,
    queryFn: async () => (await waAgentsFetch<{ counts?: Record<string, number> }>('/api/wa-agents/knowledge-gaps/summary')).counts ?? {},
    enabled,
    staleTime: 60_000,
  });
}

/** Incluir, editar, tirar da base, ignorar ou reabrir uma dúvida. */
export function useKnowledgeGapAction(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ gapId, action }: { gapId: string; action: KnowledgeGapAction }): Promise<KnowledgeGapRow> => {
      const json = await waAgentsFetch<{ gap: KnowledgeGapRow }>(`/api/wa-agents/agents/${agentId}/knowledge-gaps/${gapId}`, {
        method: 'PATCH',
        body: action,
      });
      return json.gap;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gapsKey(agentId) });
      void qc.invalidateQueries({ queryKey: GAP_SUMMARY_KEY });
      void qc.invalidateQueries({ queryKey: documentsKey(agentId) });
    },
  });
}

/** Exclui uma dúvida aberta ou ignorada. */
export function useDeleteKnowledgeGap(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (gapId: string) => {
      await waAgentsFetch<{ ok: boolean }>(`/api/wa-agents/agents/${agentId}/knowledge-gaps/${gapId}`, { method: 'DELETE' });
      return gapId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gapsKey(agentId) });
      void qc.invalidateQueries({ queryKey: GAP_SUMMARY_KEY });
    },
  });
}
```

- [ ] **Step 2: Conferir tipos:** `npx tsc --noEmit -p tsconfig.json` sem erros.

---

### Task 10: Painel "Dúvidas sem resposta"

**Files:**
- Create: `features/wa-agents/KnowledgeGapsPanel.tsx`
- Test: `features/wa-agents/KnowledgeGapsPanel.test.tsx`

- [ ] **Step 1: Escrever o teste**

```tsx
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AgentDocumentRow } from '@/lib/wa-agents/types';
import type { KnowledgeGapRow } from '@/lib/wa-agents/knowledgeGapsShared';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: toast }) }));
vi.mock('@/components/ConfirmModal', () => ({ default: () => null }));

import { KnowledgeGapsPanel } from './KnowledgeGapsPanel';

const agentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const gapId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const docId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const conversationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const clients: QueryClient[] = [];
let gaps: KnowledgeGapRow[];
let writes: Array<Record<string, unknown>>;

function doc(overrides: Partial<AgentDocumentRow> = {}): AgentDocumentRow {
  return {
    id: docId, organization_id: 'org', agent_id: agentId, name: 'Pacotes.pdf', mime: 'application/pdf', size_bytes: 10,
    storage_path: 'org/agents/a/docs/x_Pacotes.pdf', status: 'ready', error: null, chunk_count: 3, title: 'Pacotes',
    created_at: '', updated_at: '', ...overrides,
  };
}

function gap(overrides: Partial<KnowledgeGapRow> = {}): KnowledgeGapRow {
  return {
    id: gapId, organization_id: 'org', agent_id: agentId, status: 'open', question: 'Qual o nome do hotel no pacote do Rio?',
    context: 'A base cita hotel 3 estrelas, sem o nome.', suggested_answer: 'Hotel 3 estrelas em Copacabana.', answer: null,
    document_id: null, suggested_document_id: docId, occurrences: 3, test_only: true, last_conversation_id: conversationId,
    first_seen_at: new Date(Date.now() - 3_600_000).toISOString(), last_seen_at: new Date(Date.now() - 120_000).toISOString(),
    reviewed_by: null, reviewed_at: null, created_at: '', updated_at: '', ...overrides,
  };
}

function mount(props: Partial<React.ComponentProps<typeof KnowledgeGapsPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const onOpenSettings = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <KnowledgeGapsPanel agentId={agentId} enabled documents={[doc()]} onOpenSettings={onOpenSettings} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenSettings };
}

beforeEach(() => {
  toast.mockClear();
  writes = [];
  gaps = [gap()];
  // Toda a rede é atendida aqui; nenhuma chamada ao CRM.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes('/knowledge-gaps?status=')) {
      const status = new URL(path, 'http://localhost').searchParams.get('status');
      const count = (s: string) => gaps.filter(g => g.status === s).length;
      return Response.json({
        gaps: gaps.filter(g => g.status === status),
        counts: { open: count('open'), included: count('included'), ignored: count('ignored') },
        learned_by_document: {},
      });
    }
    if (path.endsWith(`/knowledge-gaps/${gapId}`) && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      writes.push(body);
      gaps = gaps.map(g => (g.id === gapId ? { ...g, status: body.action === 'ignore' ? 'ignored' : 'included' } : g));
      return Response.json({ gap: gaps[0] });
    }
    throw new Error(`Unexpected network request: ${path}`);
  }));
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.unstubAllGlobals();
});

describe('KnowledgeGapsPanel', () => {
  it('com a opção desligada e sem dúvidas, mostra como ligar', async () => {
    gaps = [];
    const view = mount({ enabled: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Ações e recursos' }));
    expect(view.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('lista a dúvida com ocorrências, marca de teste e link da conversa', async () => {
    mount();
    expect(await screen.findByText('Qual o nome do hotel no pacote do Rio?')).toBeTruthy();
    expect(screen.getByText('Perguntada 3x · última há 2 min')).toBeTruthy();
    expect(screen.getByText('Só no teste')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ver conversa/ }).getAttribute('href')).toBe(`/chats?conversation=${conversationId}`);
    expect(screen.getByRole('radio', { name: 'Abertas (1)' })).toBeTruthy();
  });

  it('responder abre o rascunho do agente e inclui no documento sugerido', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Responder' }));
    const resposta = (await screen.findByLabelText('Resposta')) as HTMLTextAreaElement;
    expect(resposta.value).toBe('Hotel 3 estrelas em Copacabana.');
    expect(screen.getByText('A base cita hotel 3 estrelas, sem o nome.')).toBeTruthy();
    fireEvent.change(resposta, { target: { value: 'Hotel Mar Azul, em Copacabana.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Incluir na base' }));
    await waitFor(() => expect(writes).toEqual([
      { action: 'include', question: 'Qual o nome do hotel no pacote do Rio?', answer: 'Hotel Mar Azul, em Copacabana.', document_id: docId },
    ]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Resposta incluída na base', 'success'));
  });

  it('sem documento pronto, a resposta vai para o novo documento Respostas aprendidas', async () => {
    mount({ documents: [doc({ status: 'processing' })] });
    fireEvent.click(await screen.findByRole('button', { name: 'Responder' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Incluir na base' }));
    await waitFor(() => expect(writes).toEqual([
      { action: 'include', question: 'Qual o nome do hotel no pacote do Rio?', answer: 'Hotel 3 estrelas em Copacabana.', create_document: true },
    ]));
  });

  it('ignorar manda a ação e avisa', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Ignorar' }));
    await waitFor(() => expect(writes).toEqual([{ action: 'ignore' }]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Dúvida ignorada', 'success'));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run features/wa-agents/KnowledgeGapsPanel.test.tsx`
Expected: FAIL (componente não existe).

- [ ] **Step 3: Implementar** `features/wa-agents/KnowledgeGapsPanel.tsx`

```tsx
'use client';

/**
 * Painel "Dúvidas sem resposta" (aba Conhecimento do agente): perguntas que o
 * agente registrou com registrar_duvida_sem_resposta. Responder inclui a
 * resposta como trecho extra do documento escolhido; Ignorar, Reabrir, Tirar
 * da base e Excluir mudam o estado da dúvida.
 */
import React, { useId, useState } from 'react';
import { ExternalLink, Loader2, MessageCircleQuestion, Pencil, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { useToast } from '@/context/ToastContext';
import type { AgentDocumentRow } from '@/lib/wa-agents/types';
import {
  formatGapAgo,
  gapReappeared,
  isLearnedAnswersDocument,
  GAP_ANSWER_MAX,
  GAP_QUESTION_MAX,
  LEARNED_DOCUMENT_TITLE,
  type KnowledgeGapAction,
  type KnowledgeGapRow,
  type KnowledgeGapStatus,
} from '@/lib/wa-agents/knowledgeGapsShared';
import { useDeleteKnowledgeGap, useKnowledgeGapAction, useWaAgentKnowledgeGaps } from './useWaAgents';
import {
  BTN_ICON,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  Badge,
  Drawer,
  EmptyState,
  Field,
  HELP_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  Notice,
  Panel,
  SUBCARD_CLASS,
  Segmented,
  Spinner,
  TEXTAREA_CLASS,
  errorMessage,
} from './ui';

const NEW_DOCUMENT = '__novo_documento__';

const EMPTY_TEXT: Record<KnowledgeGapStatus, string> = {
  open: 'Nenhuma dúvida aberta. Quando o agente não souber responder algo, a pergunta aparece aqui.',
  included: 'Nenhuma resposta incluída ainda.',
  ignored: 'Nenhuma dúvida ignorada.',
};

type Editing = { gap: KnowledgeGapRow; mode: 'include' | 'edit' };

function documentLabel(doc: AgentDocumentRow): string {
  return (doc.title ?? '').trim() || doc.name;
}

function GapItem({
  gap,
  busy,
  documentName,
  onAnswer,
  onIgnore,
  onReopen,
  onRemove,
  onDelete,
}: {
  gap: KnowledgeGapRow;
  busy: boolean;
  documentName: string | null;
  onAnswer: () => void;
  onIgnore: () => void;
  onReopen: () => void;
  onRemove: () => void;
  onDelete: () => void;
}) {
  const reappeared = gapReappeared(gap);
  return (
    <li className={SUBCARD_CLASS}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-slate-900 dark:text-white break-words">{gap.question}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Perguntada {gap.occurrences}x · última {formatGapAgo(gap.last_seen_at)}
          </p>
          {gap.test_only || reappeared || gap.last_conversation_id ? (
            <div className="flex flex-wrap items-center gap-2">
              {gap.test_only ? <Badge tone="slate">Só no teste</Badge> : null}
              {reappeared ? <Badge tone="amber">Perguntada de novo depois de incluída</Badge> : null}
              {gap.last_conversation_id ? (
                <a
                  href={`/chats?conversation=${gap.last_conversation_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Ver conversa
                </a>
              ) : null}
            </div>
          ) : null}
          {gap.status === 'included' && gap.answer ? (
            <div className="pt-1">
              <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">{gap.answer}</p>
              <p className={HELP_CLASS}>{documentName ? `No documento ${documentName}` : 'Documento de destino não encontrado'}</p>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
          {gap.status === 'open' ? (
            <>
              <button type="button" className={BTN_SMALL} onClick={onAnswer} disabled={busy}>
                Responder
              </button>
              <button type="button" className={BTN_SMALL} onClick={onIgnore} disabled={busy}>
                Ignorar
              </button>
            </>
          ) : null}
          {gap.status === 'included' ? (
            <>
              <button type="button" className={BTN_SMALL} onClick={onAnswer} disabled={busy}>
                <Pencil size={14} aria-hidden="true" />
                Editar
              </button>
              <button type="button" className={BTN_SMALL} onClick={onRemove} disabled={busy}>
                <Undo2 size={14} aria-hidden="true" />
                Tirar da base
              </button>
            </>
          ) : null}
          {gap.status === 'ignored' ? (
            <button type="button" className={BTN_SMALL} onClick={onReopen} disabled={busy}>
              <RotateCcw size={14} aria-hidden="true" />
              Reabrir
            </button>
          ) : null}
          {gap.status !== 'included' ? (
            <button
              type="button"
              className={BTN_ICON}
              onClick={onDelete}
              disabled={busy}
              aria-label={`Excluir dúvida: ${gap.question}`}
              title="Excluir"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function AnswerDrawer({
  editing,
  documents,
  pending,
  onClose,
  onSubmit,
}: {
  editing: Editing;
  documents: AgentDocumentRow[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (action: KnowledgeGapAction) => void;
}) {
  const formId = useId();
  const { gap, mode } = editing;
  const ready = documents.filter((d) => d.status === 'ready');
  const canCreate = !documents.some(isLearnedAnswersDocument);
  const initialDestination =
    [gap.document_id, gap.suggested_document_id].find((id) => !!id && ready.some((d) => d.id === id)) ??
    ready[0]?.id ??
    (canCreate ? NEW_DOCUMENT : '');
  const [question, setQuestion] = useState(gap.question);
  const [answer, setAnswer] = useState(gap.answer ?? gap.suggested_answer ?? '');
  const [destination, setDestination] = useState<string>(initialDestination);
  const valid = question.trim().length >= 3 && answer.trim().length > 0 && destination !== '';

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!valid || pending) return;
    const target = destination === NEW_DOCUMENT ? { create_document: true as const } : { document_id: destination };
    onSubmit({ action: mode, question: question.trim(), answer: answer.trim(), ...target });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={mode === 'edit' ? 'Editar resposta' : 'Responder dúvida'}
      description="A resposta vira um trecho do documento escolhido e o agente passa a usá-la na próxima mensagem."
    >
      <form id={formId} onSubmit={submit} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <Field label="Pergunta" htmlFor={`${formId}-pergunta`}>
          <textarea
            id={`${formId}-pergunta`}
            className={TEXTAREA_CLASS}
            rows={2}
            value={question}
            maxLength={GAP_QUESTION_MAX}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </Field>
        {gap.context ? (
          <div>
            <p className={LABEL_CLASS}>O que o agente encontrou</p>
            <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">{gap.context}</p>
          </div>
        ) : null}
        <Field
          label="Resposta"
          htmlFor={`${formId}-resposta`}
          help={mode === 'include' && gap.suggested_answer ? 'Rascunho do agente: revise antes de incluir.' : undefined}
        >
          <textarea
            id={`${formId}-resposta`}
            className={TEXTAREA_CLASS}
            rows={8}
            value={answer}
            maxLength={GAP_ANSWER_MAX}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </Field>
        <Field label="Documento de destino" htmlFor={`${formId}-destino`}>
          <NativeSelect id={`${formId}-destino`} className={INPUT_CLASS} value={destination} onChange={(e) => setDestination(e.target.value)}>
            {documents.map((d) => (
              <option key={d.id} value={d.id} disabled={d.status !== 'ready'}>
                {`${documentLabel(d)}${d.status === 'processing' ? ' (processando)' : d.status === 'error' ? ' (com erro)' : ''}`}
              </option>
            ))}
            {canCreate ? <option value={NEW_DOCUMENT}>{`Novo documento: ${LEARNED_DOCUMENT_TITLE}`}</option> : null}
          </NativeSelect>
        </Field>
        {destination === '' ? (
          <Notice tone="amber">Nenhum documento pronto. Aguarde o processamento terminar ou envie um documento na Base de conhecimento.</Notice>
        ) : null}
      </form>
      <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-white/10 p-4">
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={pending}>
          Cancelar
        </button>
        <button type="button" className={BTN_PRIMARY} onClick={() => submit()} disabled={!valid || pending}>
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
          {mode === 'edit' ? 'Salvar resposta' : 'Incluir na base'}
        </button>
      </div>
    </Drawer>
  );
}

export const KnowledgeGapsPanel: React.FC<{
  /** Agente salvo; null enquanto o agente novo não foi salvo */
  agentId: string | null;
  /** Opção "Aprender com dúvidas sem resposta" ligada no formulário */
  enabled: boolean;
  /** Documentos do agente (destino da resposta) */
  documents: AgentDocumentRow[];
  /** Abre a aba Ações e recursos, onde fica a opção */
  onOpenSettings: () => void;
}> = ({ agentId, enabled, documents, onOpenSettings }) => {
  const { showToast } = useToast();
  const [status, setStatus] = useState<KnowledgeGapStatus>('open');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<KnowledgeGapRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const gapsQ = useWaAgentKnowledgeGaps(agentId, status);
  const act = useKnowledgeGapAction(agentId);
  const remove = useDeleteKnowledgeGap(agentId);

  if (!agentId) return null;

  const counts = gapsQ.data?.counts ?? { open: 0, included: 0, ignored: 0 };
  const total = counts.open + counts.included + counts.ignored;
  const gaps = gapsQ.data?.gaps ?? [];
  const documentName = (id: string | null) => {
    const doc = documents.find((d) => d.id === id);
    return doc ? documentLabel(doc) : null;
  };

  const run = async (gap: KnowledgeGapRow, action: KnowledgeGapAction, okMessage: string) => {
    setBusyId(gap.id);
    try {
      await act.mutateAsync({ gapId: gap.id, action });
      showToast(okMessage, 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Não foi possível atualizar a dúvida'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deleteConfirmed = () => {
    const gap = confirmDelete;
    setConfirmDelete(null);
    if (!gap) return;
    setBusyId(gap.id);
    remove
      .mutateAsync(gap.id)
      .then(
        () => showToast('Dúvida excluída', 'success'),
        (err) => showToast(errorMessage(err, 'Não foi possível excluir a dúvida'), 'error')
      )
      .finally(() => setBusyId(null));
  };

  return (
    <Panel
      title="Dúvidas sem resposta"
      icon={<MessageCircleQuestion size={16} />}
      description="Perguntas que o agente não conseguiu responder. Responda e inclua na base para ele aprender."
      right={counts.open > 0 ? <Badge tone="amber">{counts.open === 1 ? '1 aberta' : `${counts.open} abertas`}</Badge> : undefined}
    >
      {!enabled && !gapsQ.isLoading && total === 0 ? (
        <EmptyState
          title="O agente ainda não registra dúvidas"
          description="Ligue “Aprender com dúvidas sem resposta” em Ações e recursos."
          action={
            <button type="button" className={BTN_SECONDARY} onClick={onOpenSettings}>
              Abrir Ações e recursos
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {!enabled ? (
            <Notice tone="amber">
              <span>A opção está desligada: o agente não registra dúvidas novas. </span>
              <button type="button" className="font-medium underline" onClick={onOpenSettings}>
                Abrir Ações e recursos
              </button>
            </Notice>
          ) : null}
          <Segmented<KnowledgeGapStatus>
            value={status}
            onChange={setStatus}
            ariaLabel="Filtrar dúvidas"
            options={[
              { value: 'open', label: `Abertas (${counts.open})` },
              { value: 'included', label: `Incluídas (${counts.included})` },
              { value: 'ignored', label: `Ignoradas (${counts.ignored})` },
            ]}
          />
          {gapsQ.isLoading ? (
            <Spinner label="Carregando dúvidas..." />
          ) : gapsQ.error ? (
            <Notice tone="red">{errorMessage(gapsQ.error, 'Falha ao carregar as dúvidas')}</Notice>
          ) : gaps.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{EMPTY_TEXT[status]}</p>
          ) : (
            <ul className="space-y-2" aria-label="Dúvidas">
              {gaps.map((gap) => (
                <GapItem
                  key={gap.id}
                  gap={gap}
                  busy={busyId === gap.id}
                  documentName={documentName(gap.document_id)}
                  onAnswer={() => setEditing({ gap, mode: gap.status === 'included' ? 'edit' : 'include' })}
                  onIgnore={() => void run(gap, { action: 'ignore' }, 'Dúvida ignorada')}
                  onReopen={() => void run(gap, { action: 'reopen' }, 'Dúvida reaberta')}
                  onRemove={() => void run(gap, { action: 'remove' }, 'Resposta tirada da base')}
                  onDelete={() => setConfirmDelete(gap)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {editing ? (
        <AnswerDrawer
          key={`${editing.gap.id}:${editing.mode}`}
          editing={editing}
          documents={documents}
          pending={act.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(action) => {
            act.mutateAsync({ gapId: editing.gap.id, action }).then(
              () => {
                showToast(editing.mode === 'edit' ? 'Resposta salva' : 'Resposta incluída na base', 'success');
                setEditing(null);
              },
              (err) => showToast(errorMessage(err, 'Não foi possível salvar a resposta'), 'error')
            );
          }}
        />
      ) : null}

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={deleteConfirmed}
        title="Excluir dúvida?"
        message={confirmDelete ? `"${confirmDelete.question}" será apagada de vez.` : ''}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
      />
    </Panel>
  );
};

export default KnowledgeGapsPanel;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run features/wa-agents/KnowledgeGapsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Conferir** `git status --short`.

---

### Task 11: Encaixar na tela do agente

**Files:**
- Modify: `features/wa-agents/KnowledgePanel.tsx`
- Modify: `features/wa-agents/AgentEditor.tsx`
- Modify: `features/wa-agents/AgentList.tsx`

- [ ] **Step 1: `KnowledgePanel.tsx`**

1. Props do componente, depois de `saving: boolean;`:

```tsx
  /** Painel "Dúvidas sem resposta", mostrado entre a base de conhecimento e as mídias */
  gapsPanel?: React.ReactNode;
  /** Respostas aprendidas por documento (lista e confirmação de exclusão) */
  learnedByDocument?: Record<string, number>;
```

e na desestruturação: `({ agentId, onInsertMedia, onRenameMedia, onRequestSave, saving, gapsPanel, learnedByDocument })`.

2. `DocumentRow`: nova prop `learned: number` (tipo `learned: number;` e desestruturação), e na linha de metadados, depois do `<span>` de trechos:

```tsx
          {learned > 0 ? <span>{learned === 1 ? '1 resposta aprendida' : `${learned} respostas aprendidas`}</span> : null}
```

3. No `docs.map`, passar `learned={learnedByDocument?.[doc.id] ?? 0}` ao `DocumentRow`.

4. Entre o `</Panel>` da base de conhecimento e o `<Panel title="Mídias"`, inserir `{gapsPanel}`.

5. Na mensagem do `ConfirmModal` de documento, trocar a frase por:

```tsx
            ? `"${confirm?.name}" e os trechos indexados serão apagados. O agente deixa de consultar este documento.${
                (learnedByDocument?.[confirm?.id ?? ''] ?? 0) > 0
                  ? ` As ${learnedByDocument?.[confirm?.id ?? '']} respostas aprendidas dele voltam para Dúvidas sem resposta.`
                  : ''
              }`
```

- [ ] **Step 2: `AgentEditor.tsx`**

1. Imports: `useWaAgentKnowledgeGaps` na lista de `./useWaAgents` (depois de `useWaAgentDocuments,`) e `import { KnowledgeGapsPanel } from './KnowledgeGapsPanel';` antes de `import { KnowledgePanel } from './KnowledgePanel';`.
2. Depois de `const mediaQ = useWaAgentMedia(agentId);`: `const gapsQ = useWaAgentKnowledgeGaps(agentId, 'open');`
3. Depois de `const countBadge = ...`: `const openGaps = gapsQ.data?.counts.open ?? 0;`
4. Na aba `conhecimento`, trocar `badge: countBadge(knowledgeCount),` por:

```tsx
      badge: (
        <>
          {countBadge(knowledgeCount)}
          {openGaps > 0 ? <Badge tone="amber">{openGaps === 1 ? '1 dúvida' : `${openGaps} dúvidas`}</Badge> : null}
        </>
      ),
```

5. No `<KnowledgePanel ... />` da aba Conhecimento, acrescentar:

```tsx
          learnedByDocument={gapsQ.data?.learned_by_document}
          gapsPanel={
            <KnowledgeGapsPanel
              agentId={agentId}
              enabled={form.tools.knowledge_gaps === true}
              documents={docsQ.data ?? []}
              onOpenSettings={() => setTab('acoes')}
            />
          }
```

6. Em "Recursos", logo depois do `SettingRow` da Calculadora:

```tsx
            <SettingRow
              title="Aprender com dúvidas sem resposta"
              tip="Ferramenta registrar_duvida_sem_resposta: quando o agente não acha a resposta no roteiro nem na base, ele registra a pergunta em Conhecimento › Dúvidas sem resposta para você responder."
              control={
                <Toggle
                  checked={form.tools.knowledge_gaps === true}
                  onChange={(knowledge_gaps) => patch({ tools: { ...form.tools, knowledge_gaps } })}
                  label="Aprender com dúvidas sem resposta"
                />
              }
            />
```

- [ ] **Step 3: `AgentList.tsx`**

1. Import `useWaKnowledgeGapSummary` de `./useWaAgents`.
2. Depois de `const { showToast } = useToast();` (antes do retorno antecipado `if (editor)`, para respeitar a ordem dos hooks):

```tsx
  // A lista completa (com provedor e modelo) só chega para administradores
  const gapSummary = useWaKnowledgeGapSummary((listQ.data ?? []).some((item) => asPublic(item) !== null));
```

3. Nas etiquetas do cartão, depois da etiqueta "Chave própria":

```tsx
                      {(gapSummary.data?.[item.id] ?? 0) > 0 ? (
                        <Badge tone="amber">
                          {gapSummary.data![item.id] === 1 ? '1 dúvida' : `${gapSummary.data![item.id]} dúvidas`}
                        </Badge>
                      ) : null}
```

- [ ] **Step 4: Conferir tipos e testes da tela**

Run: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run features/wa-agents`
Expected: sem erros; testes passam (o teste de mídia do `KnowledgePanel` continua sem chamadas inesperadas, porque o painel novo vem por prop).

- [ ] **Step 5: Conferir** `git status --short`.

---

### Task 12: Verificação completa

- [ ] **Step 1:** `npm run lint` — zero avisos.
- [ ] **Step 2:** `npm run typecheck` — sem erros.
- [ ] **Step 3:** `npm run test:run` — todos passam (comparar com a `origin/main` se algo falhar fora dos arquivos tocados).
- [ ] **Step 4: Conferência visual sem banco** — copiar o modelo de `output/nossocrm-painel-notificacoes-2026-11-24/pagina-de-teste/` para `.preview-harness/` no worktree, trocar a porta para 5201 e o `main.tsx` para renderizar o `KnowledgePanel` real com `gapsPanel` (dúvidas abertas, incluída e ignorada em dados fictícios, com o `fetch` das rotas `/api/wa-agents/...` respondido na própria página). Registrar `nossocrm-aprendizado-previa` em `CODEX/.claude/launch.json`, abrir com o painel de navegador, conferir em 390 px e no computador, nos temas claro e escuro, abrir a janela "Responder dúvida" e tirar os prints. Ao terminar, apagar `.preview-harness/` do worktree e a entrada do `launch.json`.
- [ ] **Step 5:** `git status --short` e `git diff --stat` para o resumo da entrega. Sem commit.
