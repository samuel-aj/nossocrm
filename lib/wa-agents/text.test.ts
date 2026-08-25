import { describe, expect, it } from 'vitest';
import { findKeyword, normalizeKeyword } from './text';

describe('normalizeKeyword', () => {
  it('põe em minúsculas, tira acentos e espaços extras', () => {
    expect(normalizeKeyword('  Não,   OBRIGADO ')).toBe('nao, obrigado');
    expect(normalizeKeyword('Revisão de Contrato')).toBe('revisao de contrato');
  });

  it('devolve vazio para entrada vazia ou nula', () => {
    expect(normalizeKeyword('')).toBe('');
    expect(normalizeKeyword(undefined as unknown as string)).toBe('');
  });
});

describe('findKeyword', () => {
  it('acha a palavra-chave ignorando acento e caixa e devolve como foi escrita', () => {
    expect(findKeyword('Olá, quero uma REVISAO de contrato', ['trabalhista', 'Revisão'])).toBe('Revisão');
  });

  it('devolve null quando nenhuma palavra-chave aparece ou o texto é vazio', () => {
    expect(findKeyword('bom dia', ['contrato'])).toBeNull();
    expect(findKeyword('', ['contrato'])).toBeNull();
    expect(findKeyword('contrato', [])).toBeNull();
  });

  it('ignora palavras-chave vazias', () => {
    expect(findKeyword('qualquer coisa', ['', '  '])).toBeNull();
  });
});
