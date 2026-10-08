import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAD_SOURCES, getDealLeadSource, normalizeLeadSource, readDbLeadSource } from './leadSource';

describe('deal acquisition source', () => {
  it('normalizes strings without guessing categories or stringifying malformed legacy data', () => {
    expect(normalizeLeadSource('  Feira\n  de negócios  ')).toBe('Feira de negócios');
    for (const value of [null, undefined, {}, ['Meta Ads'], 12, false, ' \n ']) {
      expect(normalizeLeadSource(value)).toBeNull();
    }
    expect(DEFAULT_LEAD_SOURCES).toEqual(['Google Ads', 'Meta Ads', 'Indicação', 'Orgânico/Rede Social', 'Presencial', 'Outros']);
  });
  it('distinguishes explicit empty source from an untouched legacy deal', () => {
    expect(getDealLeadSource({ customFields: { origem: ' Meta Ads ' } })).toBe('Meta Ads');
    expect(getDealLeadSource({ leadSource: null, customFields: { origem: 'Meta Ads' } })).toBeNull();
    expect(getDealLeadSource({ leadSource: 'Presencial', customFields: { origem: 'Meta Ads' } })).toBe('Presencial');
  });
  it('reads pre-initialized database rows through legacy origem, never through UTMs', () => {
    expect(readDbLeadSource({ lead_source: null, lead_source_initialized: false, custom_fields: { origem: 'Meta Ads' } })).toBe('Meta Ads');
    expect(readDbLeadSource({ custom_fields: { utm_source: 'google', utm_medium: 'cpc' } })).toBeNull();
    expect(readDbLeadSource({ custom_fields: { origem: { value: 'Google Ads' } } })).toBeNull();
  });
  it('honors initialized null and handles projections containing a native value without its flag', () => {
    expect(readDbLeadSource({ lead_source: null, lead_source_initialized: true, custom_fields: { origem: 'Meta Ads' } })).toBeNull();
    expect(readDbLeadSource({ lead_source: 'Indicação', custom_fields: { origem: 'Meta Ads' } })).toBe('Indicação');
  });
});
