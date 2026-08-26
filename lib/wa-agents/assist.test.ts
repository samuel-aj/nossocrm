import { describe, expect, it } from 'vitest';
import { adjustInstruction, formatAssistExamples, normalizeSuggestions, slugifyKey, validateAssistInput } from './assist';
import { AssistInputSchema } from './types';

describe('slugifyKey', () => {
  it('gera chave válida (minúsculas, sem acento, hífens) e limita a 40 caracteres', () => {
    expect(slugifyKey('Já tem advogado', 0)).toBe('ja-tem-advogado');
    expect(slugifyKey('  Análise   Humana!! ', 0)).toBe('analise-humana');
    expect(slugifyKey('a'.repeat(60), 0)).toHaveLength(40);
    expect(slugifyKey('???', 2)).toBe('item-3');
  });
});

describe('normalizeSuggestions', () => {
  it('normaliza chaves, evita duplicadas, corta tamanhos e preenche descrição obrigatória', () => {
    const out = normalizeSuggestions(
      [
        { key: 'Qualificado', label: 'Qualificado', description: 'Lead passou pelos requisitos' },
        { key: 'qualificado', label: 'Qualificado de novo', description: '' },
        { label: 'Sem chave', description: 'x'.repeat(700) },
        { key: '', label: '', description: 'ignorado' },
      ],
      { descriptionMax: 600, descriptionRequired: true }
    );
    expect(out.map(o => o.key)).toEqual(['qualificado', 'qualificado-2', 'sem-chave']);
    expect(out[1].description).toBe('Qualificado de novo');
    expect(out[2].description).toHaveLength(600);
    expect(out.every(o => Array.isArray(o.actions) && o.actions.length === 0)).toBe(true);
  });
});

describe('validateAssistInput', () => {
  it('exige os campos de cada modo', () => {
    expect(validateAssistInput({ mode: 'generate' })).toBeTruthy();
    expect(validateAssistInput({ mode: 'generate', description: 'Escritório trabalhista' })).toBeNull();
    expect(validateAssistInput({ mode: 'improve' })).toBeTruthy();
    expect(validateAssistInput({ mode: 'adjust', current_prompt: '# PAPEL' })).toBeTruthy();
    expect(validateAssistInput({ mode: 'adjust', current_prompt: '# PAPEL', instruction: 'mais curto' })).toBeNull();
  });

  it('adjust aceita feedback como sinônimo de instruction', () => {
    expect(validateAssistInput({ mode: 'adjust', current_prompt: '# PAPEL', feedback: 'se apresentou duas vezes' })).toBeNull();
    expect(adjustInstruction({ feedback: ' não ofereça desconto ' })).toBe('não ofereça desconto');
    expect(adjustInstruction({ instruction: 'a', feedback: 'b' })).toBe('a');
  });
});

describe('formatAssistExamples', () => {
  it('formata as últimas mensagens do teste como Cliente/Agente e ignora vazias', () => {
    expect(
      formatAssistExamples([
        { role: 'user', text: 'Oi,\n tudo bem?' },
        { role: 'assistant', text: '   ' },
        { role: 'assistant', text: 'Olá! Sou a Ana.' },
      ])
    ).toBe('Cliente: Oi, tudo bem?\nAgente: Olá! Sou a Ana.');
    expect(formatAssistExamples(undefined)).toBe('');
  });

  it('AssistInputSchema aceita feedback e examples', () => {
    const parsed = AssistInputSchema.parse({
      mode: 'adjust',
      current_prompt: '# PAPEL',
      feedback: 'ele se apresentou duas vezes',
      examples: [{ role: 'user', text: 'oi' }],
    });
    expect(parsed.feedback).toBe('ele se apresentou duas vezes');
    expect(parsed.examples).toHaveLength(1);
  });
});
