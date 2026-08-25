import { describe, expect, it } from 'vitest';
import { normalizeSuggestions, slugifyKey, validateAssistInput } from './assist';

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
});
