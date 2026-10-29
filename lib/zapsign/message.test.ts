import { describe, expect, it } from 'vitest';
import { DEFAULT_SIGN_MESSAGE, ensureSignLink, hasSignLink, insertSignToken, splitSignMessage } from './message';

describe('ensureSignLink', () => {
  it('mantém a mensagem que já tem o link', () => {
    expect(ensureSignLink('Assine aqui: {{link}}')).toBe('Assine aqui: {{link}}');
    expect(ensureSignLink('Assine aqui: {{ link }}')).toBe('Assine aqui: {{ link }}');
  });
  it('põe o link no final quando a pessoa tirou', () => {
    expect(ensureSignLink('Olá {{primeiro_nome}}, segue o contrato.  ')).toBe('Olá {{primeiro_nome}}, segue o contrato.\n\n{{link}}');
  });
  it('mensagem vazia vira a padrão', () => {
    expect(ensureSignLink('   ')).toBe(DEFAULT_SIGN_MESSAGE);
    expect(hasSignLink(DEFAULT_SIGN_MESSAGE)).toBe(true);
  });
});

describe('splitSignMessage', () => {
  it('separa texto e variáveis, marcando as desconhecidas', () => {
    expect(splitSignMessage('Oi {{primeiro_nome}}: {{link}} {{cpf}}')).toEqual([
      { kind: 'text', text: 'Oi ' },
      { kind: 'var', name: 'primeiro_nome', known: true },
      { kind: 'text', text: ': ' },
      { kind: 'var', name: 'link', known: true },
      { kind: 'text', text: ' ' },
      { kind: 'var', name: 'cpf', known: false },
    ]);
  });
  it('texto sem variável vira um único pedaço', () => {
    expect(splitSignMessage('sem nada')).toEqual([{ kind: 'text', text: 'sem nada' }]);
    expect(splitSignMessage('')).toEqual([]);
  });
});

describe('insertSignToken', () => {
  it('insere no cursor com espaço quando encosta em texto', () => {
    expect(insertSignToken('Olá, segue', '{{link}}', 4)).toEqual({ next: 'Olá, {{link}} segue', caret: 13 });
    expect(insertSignToken('Olá ', '{{nome}}', 4)).toEqual({ next: 'Olá {{nome}}', caret: 12 });
  });
  it('substitui a seleção', () => {
    expect(insertSignToken('Oi fulano!', '{{nome}}', 3, 9)).toEqual({ next: 'Oi {{nome}}!', caret: 11 });
  });
});
