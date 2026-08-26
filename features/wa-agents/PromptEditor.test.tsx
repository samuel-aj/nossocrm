import { describe, it, expect } from 'vitest';
import { actionToken, insertToken, mediaToken } from './PromptEditor';
import { PROMPT_TOKEN_MIME, isPromptTokenDrag } from './ui';

describe('insertToken', () => {
  it('insere no meio de uma palavra com espaços ao redor', () => {
    const r = insertToken('abcdef', '{{nome_lead}}', 3);
    expect(r.next).toBe('abc {{nome_lead}} def');
    expect(r.caret).toBe('abc {{nome_lead}} '.length);
  });

  it('não duplica espaços já existentes', () => {
    const r = insertToken('oi tudo', '{{x}}', 3);
    expect(r.next).toBe('oi {{x}} tudo');
    expect(r.caret).toBe('oi {{x}} '.length);
  });

  it('no início e no fim não coloca espaço sobrando', () => {
    expect(insertToken('', '{{x}}', 0).next).toBe('{{x}}');
    expect(insertToken('texto', '{{x}}', 0).next).toBe('{{x}} texto');
    expect(insertToken('texto', '{{x}}', 5).next).toBe('texto {{x}}');
    expect(insertToken('linha\n', '{{x}}', 6).next).toBe('linha\n{{x}}');
  });

  it('substitui a seleção', () => {
    const r = insertToken('a SELECIONADO b', '[[acao:x]]', 2, 13);
    expect(r.next).toBe('a [[acao:x]] b');
  });

  it('limita posições fora do texto', () => {
    expect(insertToken('ab', '{{x}}', 99).next).toBe('ab {{x}}');
    expect(insertToken('ab', '{{x}}', -5).next).toBe('{{x}} ab');
  });
});

describe('tokens', () => {
  it('monta os marcadores de ação e mídia', () => {
    expect(actionToken('tem-advogado')).toBe('[[acao:tem-advogado]]');
    expect(mediaToken('Tabela de preços')).toBe('[[midia:Tabela de preços]]');
  });
});

describe('isPromptTokenDrag', () => {
  it('só reconhece o arrasto de um chip (texto comum e arquivos ficam com o navegador)', () => {
    expect(isPromptTokenDrag([PROMPT_TOKEN_MIME, 'text/plain'])).toBe(true);
    expect(isPromptTokenDrag(['text/plain'])).toBe(false);
    expect(isPromptTokenDrag(['Files'])).toBe(false);
    expect(isPromptTokenDrag(undefined)).toBe(false);
  });
});
