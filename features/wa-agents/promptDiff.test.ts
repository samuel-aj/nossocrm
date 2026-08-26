import { describe, it, expect } from 'vitest';
import { describeDiff, diffLines, toLines } from './promptDiff';

describe('toLines', () => {
  it('normaliza quebras de linha e trata vazio', () => {
    expect(toLines('')).toEqual([]);
    expect(toLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('diffLines', () => {
  it('sem mudança: só linhas iguais', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc');
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.ops.every((op) => op.type === 'same')).toBe(true);
    expect(d.approximate).toBe(false);
  });

  it('conta linhas adicionadas e removidas na ordem do texto', () => {
    const d = diffLines('# PAPEL\nlinha 1\nlinha 2\n# TOM', '# PAPEL\nlinha 1\nlinha nova\n# TOM\nfim');
    expect(d.removed).toBe(1);
    expect(d.added).toBe(2);
    expect(d.ops).toEqual([
      { type: 'same', text: '# PAPEL' },
      { type: 'same', text: 'linha 1' },
      { type: 'del', text: 'linha 2' },
      { type: 'add', text: 'linha nova' },
      { type: 'same', text: '# TOM' },
      { type: 'add', text: 'fim' },
    ]);
    expect(d.before).toEqual({ lines: 4, chars: '# PAPEL\nlinha 1\nlinha 2\n# TOM'.length });
    expect(d.after.lines).toBe(5);
  });

  it('texto vazio para texto cheio: tudo adicionado', () => {
    const d = diffLines('', 'a\nb');
    expect(d.added).toBe(2);
    expect(d.removed).toBe(0);
    expect(d.before.lines).toBe(0);
  });

  it('modo aproximado quando o miolo é grande demais', () => {
    const big = (prefix: string) => Array.from({ length: 1600 }, (_, i) => `${prefix}${i}`).join('\n');
    const d = diffLines(big('a'), big('b'));
    expect(d.approximate).toBe(true);
    expect(d.removed).toBe(1600);
    expect(d.added).toBe(1600);
  });
});

describe('describeDiff', () => {
  it('descreve em pt-BR com singular e plural', () => {
    const d = diffLines('a\nb', 'a\nc\nd');
    expect(describeDiff(d)).toBe('2 linhas adicionadas, 1 linha removida. Linhas: 2 para 3. Caracteres: 3 para 5.');
  });

  it('avisa quando nada mudou', () => {
    expect(describeDiff(diffLines('x', 'x'))).toMatch(/^Nenhuma linha mudou\./);
  });
});
