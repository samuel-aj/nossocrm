import { describe, expect, it } from 'vitest';
import { buildLeadPatch, coerceCustomFieldValue, parseDateBr, parseNumberPtBr } from './leadFields';

describe('valores de campo personalizado', () => {
  it('números em formato brasileiro', () => {
    expect(parseNumberPtBr('1.234,56')).toBe(1234.56);
    expect(parseNumberPtBr('R$ 10')).toBe(10);
    expect(parseNumberPtBr('dez')).toBeNull();
  });

  it('datas', () => {
    expect(parseDateBr('31/12/2026')).toBe('2026-12-31');
    expect(parseDateBr('2026-02-30')).toBeNull();
  });

  it('seleção aceita a opção sem acento ou maiúscula e recusa o que não existe', () => {
    const def = { key: 'origem', label: 'Origem', type: 'select', options: ['Google Ads', 'Indicação'] };
    expect(coerceCustomFieldValue(def, 'indicacao')).toEqual({ ok: true, value: 'Indicação' });
    expect(coerceCustomFieldValue(def, 'TikTok').ok).toBe(false);
  });

  it('múltipla seleção substitui ou acrescenta sem repetir', () => {
    const def = { key: 'temas', type: 'multiselect', options: ['BPC', 'Aposentadoria', 'Auxílio'] };
    expect(coerceCustomFieldValue(def, 'bpc; auxilio')).toEqual({ ok: true, value: ['BPC', 'Auxílio'] });
    expect(coerceCustomFieldValue(def, 'Auxílio', 'append', ['BPC', 'Auxílio'])).toEqual({ ok: true, value: ['BPC', 'Auxílio'] });
  });
});

describe('alterações do lead', () => {
  const defs = [
    { key: 'valor_causa', label: 'Valor da causa', type: 'currency' },
    { key: 'origem', label: 'Origem', type: 'select', options: ['Google', 'Meta'] },
  ];

  it('só mexe no que foi listado; acrescenta, converte e aponta o que não deu', () => {
    const r = buildLeadPatch(
      [
        { field: 'description', mode: 'append', value: 'Olá {{nome}}' },
        { field: 'custom_field', key: 'valor_causa', mode: 'replace', value: '2.500,00' },
        { field: 'custom_field', key: 'origem', mode: 'replace', value: 'TikTok' },
        { field: 'custom_field', key: 'apagado', mode: 'replace', value: 'x' },
      ],
      {
        render: (t) => t.replace('{{nome}}', 'Maria'),
        current: { description: 'Linha antiga', custom_fields: { outro: 1 } },
        defs,
      }
    );
    expect(r.columns).toEqual({ description: 'Linha antiga\nOlá Maria' });
    expect(r.customFields).toEqual({ valor_causa: 2500 });
    expect(r.problems).toHaveLength(2);
    expect(r.problems.join(' ')).toContain('TikTok');
  });

  it('limpar campo personalizado marca para remover', () => {
    const r = buildLeadPatch([{ field: 'custom_field', key: 'origem', mode: 'clear' }], {
      render: (t) => t,
      current: { custom_fields: { origem: 'Google' } },
      defs,
    });
    expect(r.customFields).toEqual({ origem: null });
    expect(r.problems).toEqual([]);
  });
});
