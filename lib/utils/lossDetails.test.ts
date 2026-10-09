import { describe, expect, it } from 'vitest';
import { groupLossReasons, lossDetailsDescription, lossReasonGroupKey, lossReasonGroupLabel, normalizeLossReason } from './lossDetails';

describe('loss reason grouping', () => {
  it('groups only the known repeated-contact aliases under one stable key', () => {
    for (const reason of ['Contato Repetido', 'Lead repetido', 'Repetido', '  CONTATO—REPETIDO!!  ', 'Léad   repetído']) {
      expect(lossReasonGroupKey(reason)).toBe('duplicate_contact');
      expect(lossReasonGroupLabel(reason)).toBe('Contato repetido');
    }
  });

  it('normalizes casing, accents, punctuation and spacing without semantic inference', () => {
    expect(normalizeLossReason('  PREÇO—muito   alto! ')).toBe('preco muito alto');
    expect(lossReasonGroupKey('Preço muito alto')).toBe(lossReasonGroupKey('preco-muito-alto.'));
    expect(lossReasonGroupKey('Sem orçamento')).not.toBe(lossReasonGroupKey('Preço muito alto'));
    expect(lossReasonGroupKey('Cliente repetiu a compra')).not.toBe(lossReasonGroupKey('Repetido'));
    expect(lossReasonGroupKey('Contato repetido, mas interessado')).not.toBe(lossReasonGroupKey('Contato repetido'));
    expect(lossReasonGroupKey('Valor > 100')).not.toBe(lossReasonGroupKey('Valor < 100'));
  });

  it('keeps exact originals and lead references when grouping for a report', () => {
    const deals = Object.freeze([
      Object.freeze({ id: 'a', lossReason: ' Contato Repetido ' }),
      Object.freeze({ id: 'b', lossReason: 'Lead repetido' }),
      Object.freeze({ id: 'c', lossReason: 'Preço muito alto' }),
      Object.freeze({ id: 'd', lossReason: 'PRECO MUITO ALTO!' }),
    ]);
    const groups = groupLossReasons(deals);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: 'duplicate_contact', label: 'Contato repetido', count: 2, originals: [' Contato Repetido ', 'Lead repetido'] });
    expect(groups[1]).toMatchObject({ key: 'text:preco muito alto', count: 2, originals: ['Preço muito alto', 'PRECO MUITO ALTO!'] });
    expect(groups[0].items[0]).toBe(deals[0]);
    expect(lossDetailsDescription('disqualified', deals[1].lossReason)).toContain('Motivo da perda: Lead repetido');
  });

  it('groups absent and explicitly unreported reasons without confusing custom Other', () => {
    for (const reason of [null, undefined, '', '   ', ' NÃO INFORMADO. ']) expect(lossReasonGroupKey(reason)).toBe('not_informed');
    expect(lossReasonGroupLabel(null)).toBe('Não informado');
    expect(lossReasonGroupKey('Outro')).toBe('text:outro');
  });
});
