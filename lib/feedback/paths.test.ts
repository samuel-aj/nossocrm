import { describe, expect, it } from 'vitest';
import { feedbackFilePath, ownsFeedbackPath, deviceFromUserAgent } from './paths';

describe('feedbackFilePath', () => {
  it('monta org/usuário/uuid_nome e limpa o nome', () => {
    expect(feedbackFilePath('o1', 'u1', 'id9', 'Print da tela (1).PNG')).toBe('o1/u1/id9_print-da-tela-1.png');
  });
  it('limita o nome a 80 caracteres e mantém a extensão', () => {
    const p = feedbackFilePath('o1', 'u1', 'id9', `${'a'.repeat(200)}.pdf`);
    expect(p.endsWith('.pdf')).toBe(true);
    expect(p.length).toBeLessThanOrEqual('o1/u1/id9_'.length + 80);
  });
  it('dá nome padrão quando o nome some na limpeza', () => {
    expect(feedbackFilePath('o1', 'u1', 'id9', '###')).toBe('o1/u1/id9_arquivo');
  });
});

describe('ownsFeedbackPath', () => {
  it('aceita só caminhos da própria pasta', () => {
    expect(ownsFeedbackPath('o1', 'u1', 'o1/u1/x_a.png')).toBe(true);
    expect(ownsFeedbackPath('o1', 'u1', 'o1/u2/x_a.png')).toBe(false);
    expect(ownsFeedbackPath('o1', 'u1', 'o1/u1/../u2/x_a.png')).toBe(false);
    expect(ownsFeedbackPath('o1', 'u1', 'o1/u1/sub/x_a.png')).toBe(false);
  });
});

describe('deviceFromUserAgent', () => {
  it('reconhece celular', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('celular');
    expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel) Mobile Safari')).toBe('celular');
  });
  it('trata o resto como computador', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('computador');
    expect(deviceFromUserAgent(null)).toBe('computador');
  });
});
