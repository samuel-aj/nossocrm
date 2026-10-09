import { describe, expect, it } from 'vitest';
import { buildDealLeadSourceContext } from './leadSourceContext';

describe('deal acquisition context', () => {
  it.each([
    [undefined, 'Meta Ads'],
    [null, null],
    ['Indicação', 'Indicação'],
  ])('serializes source %s without a competing legacy origin', (leadSource, expected) => {
    const customFields = Object.freeze({ origem: 'Meta Ads', utm_source: 'facebook', utm_campaign: 'Retorno', assunto: 'BPC' });
    const result = JSON.parse(JSON.stringify(buildDealLeadSourceContext({ leadSource, customFields })));
    expect(result).toEqual({ leadSource: expected, customFields: { utm_source: 'facebook', utm_campaign: 'Retorno', assunto: 'BPC' } });
    expect(customFields.origem).toBe('Meta Ads');
  });
});
