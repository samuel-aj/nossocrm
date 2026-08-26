import { describe, expect, it } from 'vitest';
import { CALC_MAX_LENGTH, evaluateExpression, formatCalcResult } from './calc';

describe('evaluateExpression', () => {
  it('resolve as quatro operações com precedência e parênteses', () => {
    expect(evaluateExpression('1 + 2 * 3')).toBe(7);
    expect(evaluateExpression('(1 + 2) * 3')).toBe(9);
    expect(evaluateExpression('10 / 4')).toBe(2.5);
    expect(evaluateExpression('10 - 2 - 3')).toBe(5);
    expect(evaluateExpression('100 / 10 / 2')).toBe(5);
    expect(evaluateExpression('7 % 3')).toBe(1);
  });

  it('potência é associativa à direita e o sinal unário fica abaixo dela', () => {
    expect(evaluateExpression('2 ^ 3 ^ 2')).toBe(512);
    expect(evaluateExpression('-2 ^ 2')).toBe(-4);
    expect(evaluateExpression('(-2) ^ 2')).toBe(4);
    expect(evaluateExpression('2 ^ -1')).toBe(0.5);
    expect(evaluateExpression('-3 * -2')).toBe(6);
    expect(evaluateExpression('+5')).toBe(5);
  });

  it('aceita as funções previstas, inclusive com vários argumentos', () => {
    expect(evaluateExpression('sqrt(16)')).toBe(4);
    expect(evaluateExpression('abs(-3.5)')).toBe(3.5);
    expect(evaluateExpression('round(2.567, 2)')).toBe(2.57);
    expect(evaluateExpression('round(2.5)')).toBe(3);
    expect(evaluateExpression('floor(2.9) + ceil(2.1)')).toBe(5);
    expect(evaluateExpression('min(3, 1, 2)')).toBe(1);
    expect(evaluateExpression('max(3, 1, 2)')).toBe(3);
    expect(evaluateExpression('pow(2, 10)')).toBe(1024);
    expect(evaluateExpression('MAX(1, sqrt(81))')).toBe(9);
  });

  it('normaliza sinais tipográficos e notação científica', () => {
    expect(evaluateExpression('3 × 4 ÷ 2')).toBe(6);
    expect(evaluateExpression('10 − 4')).toBe(6);
    expect(evaluateExpression('1.5e3 + .5')).toBe(1500.5);
  });

  it('exemplo real de honorários: percentual com arredondamento', () => {
    expect(evaluateExpression('round(15000 * 0.3, 2)')).toBe(4500);
    expect(evaluateExpression('round(1234.5678 * 1.1, 2)')).toBe(1358.02);
  });

  it('rejeita identificadores desconhecidos e qualquer tentativa de código', () => {
    for (const expr of [
      'x + 1',
      'pi * 2',
      'process.exit()',
      'Math.max(1, 2)',
      'constructor',
      'sqrt',
      'sqrt 4',
      'foo(1)',
      '1; 2',
      '2 = 2',
      '"a"',
    ]) {
      expect(() => evaluateExpression(expr), expr).toThrow('expressão inválida');
    }
  });

  it('rejeita sintaxe inválida', () => {
    for (const expr of ['', '   ', '1 +', '* 2', '(1 + 2', '1 + 2)', '()', 'min()', 'min(1,)', 'min(,1)', '1 2', '2 ** 2', 'sqrt(1, 2)', 'pow(2)']) {
      expect(() => evaluateExpression(expr), expr).toThrow('expressão inválida');
    }
  });

  it('rejeita divisão por zero, resultado infinito e expressões longas demais', () => {
    expect(() => evaluateExpression('1 / 0')).toThrow('expressão inválida');
    expect(() => evaluateExpression('5 % 0')).toThrow('expressão inválida');
    expect(() => evaluateExpression('10 ^ 400')).toThrow('expressão inválida');
    expect(() => evaluateExpression('1+'.repeat(CALC_MAX_LENGTH) + '1')).toThrow('expressão inválida');
  });

  it('nunca devolve -0', () => {
    expect(Object.is(evaluateExpression('-0'), 0)).toBe(true);
    expect(Object.is(evaluateExpression('0 * -1'), 0)).toBe(true);
  });
});

describe('formatCalcResult', () => {
  it('mostra inteiros sem casas e decimais sem zeros sobrando', () => {
    expect(formatCalcResult(4500)).toBe('4500');
    expect(formatCalcResult(2.5)).toBe('2.5');
    expect(formatCalcResult(0.1 + 0.2)).toBe('0.3');
  });
});
