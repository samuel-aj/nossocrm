import { describe, expect, it } from 'vitest';
import {
  mergeSavedDataInto,
  normalizeSavedKey,
  sanitizeSavedData,
  sanitizeSavedValue,
  SAVED_DATA_MAX_CHARS,
  SAVED_DATA_MAX_KEYS,
} from './savedData';

describe('dados salvos (salvar_dados)', () => {
  it('normaliza as chaves para snake_case ASCII curto', () => {
    expect(normalizeSavedKey('Nome Completo')).toBe('nome_completo');
    expect(normalizeSavedKey('  Cidade natal! ')).toBe('cidade_natal');
    expect(normalizeSavedKey('instruções_do_sistema')).toBe('instrucoes_do_sistema');
    expect(normalizeSavedKey('***')).toBe('');
    expect(normalizeSavedKey('a'.repeat(80))).toHaveLength(40);
  });

  it('mantém só valores primitivos curtos, em uma linha, sem o marcador de silêncio', () => {
    expect(sanitizeSavedValue('  João\nda Silva  ')).toBe('João da Silva');
    expect(sanitizeSavedValue('ok [SEM_RESPOSTA] ok')).toBe('ok ok');
    expect(sanitizeSavedValue('x'.repeat(500))).toHaveLength(200);
    expect(sanitizeSavedValue(42)).toBe(42);
    expect(sanitizeSavedValue(true)).toBe(true);
    expect(sanitizeSavedValue(null)).toBeNull();
    expect(sanitizeSavedValue(Number.NaN)).toBeUndefined();
    expect(sanitizeSavedValue({ a: 1 })).toBeUndefined();
    expect(sanitizeSavedValue(['a', 'b'])).toBe('a, b');
  });

  it('descarta objetos aninhados, limita a 30 chaves (as mais recentes vencem) e 2 KB', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) big[`campo_${i}`] = `valor ${i}`;
    const out = sanitizeSavedData({ ...big, aninhado: { x: 1 } });
    expect(Object.keys(out)).toHaveLength(SAVED_DATA_MAX_KEYS);
    expect(out.campo_39).toBe('valor 39');
    expect(out.campo_0).toBeUndefined();
    expect(out.aninhado).toBeUndefined();

    const long: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) long[`texto_${i}`] = 'y'.repeat(200);
    const clipped = sanitizeSavedData(long);
    expect(JSON.stringify(clipped).length).toBeLessThanOrEqual(SAVED_DATA_MAX_CHARS);
    expect(clipped.texto_19).toBeDefined();
  });

  it('mescla os dados novos sobre os salvos e sanea o resultado', () => {
    const merged = mergeSavedDataInto({ nome: 'Ana', cidade: 'Recife' }, { Cidade: 'Olinda', urgencia: 'alta\nmuito' });
    expect(merged).toEqual({ nome: 'Ana', cidade: 'Olinda', urgencia: 'alta muito' });
    expect(sanitizeSavedData(null)).toEqual({});
    expect(sanitizeSavedData(['a'])).toEqual({});
  });
});
