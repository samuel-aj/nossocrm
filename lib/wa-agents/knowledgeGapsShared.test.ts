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
