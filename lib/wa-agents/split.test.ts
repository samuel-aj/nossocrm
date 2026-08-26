import { describe, expect, it } from 'vitest';
import { isOnlySymbols, MAX_LINES, splitLines } from './split';

describe('splitLines', () => {
  it('divide por quebra de linha, remove vazias e faz trim', () => {
    expect(splitLines('  Oi, tudo bem?  \n\n\nMe conta o que aconteceu.\n')).toEqual([
      'Oi, tudo bem?',
      'Me conta o que aconteceu.',
    ]);
  });

  it('normaliza \\r\\n', () => {
    expect(splitLines('Linha 1\r\nLinha 2\rLinha 3')).toEqual(['Linha 1', 'Linha 2', 'Linha 3']);
  });

  it('junta linhas só de pontuação ou emoji com a anterior', () => {
    expect(splitLines('Que bom te ver por aqui\n😊\nComo posso ajudar?\n...')).toEqual([
      'Que bom te ver por aqui 😊',
      'Como posso ajudar? ...',
    ]);
  });

  it('mantém emoji sozinho quando é a primeira linha', () => {
    expect(splitLines('👋\nOi!')).toEqual(['👋', 'Oi!']);
  });

  it('limita a MAX_LINES concatenando o excedente na última', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Linha ${i + 1}`).join('\n');
    const out = splitLines(many);
    expect(out).toHaveLength(MAX_LINES);
    expect(out[0]).toBe('Linha 1');
    expect(out[MAX_LINES - 1]).toBe('Linha 8\nLinha 9\nLinha 10\nLinha 11\nLinha 12');
  });

  it('devolve lista vazia para texto vazio ou só espaços', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('   \n  \n')).toEqual([]);
  });
});

describe('isOnlySymbols', () => {
  it('reconhece pontuação e emoji', () => {
    expect(isOnlySymbols('!!!')).toBe(true);
    expect(isOnlySymbols('🙏🏽')).toBe(true);
    expect(isOnlySymbols('👨‍👩‍👧')).toBe(true);
    expect(isOnlySymbols('ok!')).toBe(false);
    expect(isOnlySymbols('123')).toBe(false);
    expect(isOnlySymbols('')).toBe(false);
  });
});
