import { describe, it, expect } from 'vitest';
import { META_WINDOW_MS, formatRemaining, getServiceWindow } from './serviceWindow';

const MIN = 60_000;
const NOW = Date.parse('2026-08-25T12:00:00.000Z');
const FECHADA = { open: false, expiresAt: null, remainingMs: 0 };

describe('getServiceWindow', () => {
  it('sem mensagem recebida (ou data inválida): janela fechada e sem prazo', () => {
    expect(getServiceWindow(null, NOW)).toEqual(FECHADA);
    expect(getServiceWindow(undefined, NOW)).toEqual(FECHADA);
    expect(getServiceWindow('', NOW)).toEqual(FECHADA);
    expect(getServiceWindow('não é data', NOW)).toEqual(FECHADA);
  });

  it('mensagem recebida há 5 h 12 min: janela aberta com o restante certo', () => {
    const decorrido = (5 * 60 + 12) * MIN;
    const lastIn = new Date(NOW - decorrido).toISOString();
    const win = getServiceWindow(lastIn, NOW);
    expect(win.open).toBe(true);
    expect(win.expiresAt).toBe(NOW - decorrido + META_WINDOW_MS);
    expect(win.remainingMs).toBe(META_WINDOW_MS - decorrido);
    expect(formatRemaining(win.remainingMs)).toBe('18 h 48 min');
  });

  it('mensagem recebida há mais de 24 h: janela fechada, restante zero, prazo no passado', () => {
    const lastIn = new Date(NOW - META_WINDOW_MS - 1).toISOString();
    const win = getServiceWindow(lastIn, NOW);
    expect(win.open).toBe(false);
    expect(win.remainingMs).toBe(0);
    expect(win.expiresAt).toBe(NOW - 1);
  });

  it('exatamente 24 h: já fechada', () => {
    const lastIn = new Date(NOW - META_WINDOW_MS).toISOString();
    expect(getServiceWindow(lastIn, NOW).open).toBe(false);
  });

  it('aceita o formato timestamptz do Postgres (microssegundos + fuso)', () => {
    const win = getServiceWindow('2026-08-25T10:00:00.123456+00:00', NOW);
    expect(win.open).toBe(true);
    expect(win.remainingMs).toBe(META_WINDOW_MS - 2 * 60 * MIN + 123);
  });
});

describe('formatRemaining', () => {
  it('horas e minutos', () => {
    expect(formatRemaining((5 * 60 + 12) * MIN)).toBe('5 h 12 min');
  });

  it('só minutos', () => {
    expect(formatRemaining(45 * MIN)).toBe('45 min');
  });

  it('menos de 1 min (inclusive zero)', () => {
    expect(formatRemaining(59_000)).toBe('menos de 1 min');
    expect(formatRemaining(0)).toBe('menos de 1 min');
  });

  it('hora cheia sem "0 min"', () => {
    expect(formatRemaining(2 * 60 * MIN)).toBe('2 h');
  });

  it('não arredonda pra cima', () => {
    expect(formatRemaining(45 * MIN + 59_000)).toBe('45 min');
  });
});
