import { describe, expect, it } from 'vitest';
import type { BoardStage, CustomFieldDefinition, Deal } from '@/types';
import { customStageValueFilled, getMissingStageFields } from './stageRequirements';

const deal = { items: [], customFields: {}, leadSource: null } as unknown as Deal;
const stage = (requiredFields: string[]) => ({ requiredFields }) as BoardStage;
const field = (type: CustomFieldDefinition['type']) => ({ id: 'f', key: 'field', label: 'Campo', type, options: ['A', 'B'] });
describe('stage entry requirements', () => {
  it('uses only destination requirements and never treats absence of rules as a requirement', () => {
    expect(getMissingStageFields(deal, stage([]), [])).toEqual([]);
    expect(getMissingStageFields(deal, stage(['products','leadSource']), []).map(f => f.id)).toEqual(['products','leadSource']);
  });
  it('recognizes products, native/legacy origin and owner already present', () => {
    const filled = { ...deal, leadSource: undefined, customFields: { origem: 'Meta Ads' }, ownerId: 'u', items: [{ name: 'Serviço', price: 0, quantity: 1 }] } as Deal;
    expect(getMissingStageFields(filled, stage(['products','leadSource','ownerId']), [])).toEqual([]);
    expect(getMissingStageFields({ ...filled, leadSource: ' Não informado ' }, stage(['leadSource']), [])).toHaveLength(1);
  });
  it.each([undefined, null, 0, -1, NaN, Infinity, -Infinity, '100'])('asks for a positive deal value when it is %s', value => {
    const missing = getMissingStageFields({ ...deal, value } as Deal, stage(['value']), []);
    expect(missing).toEqual([{ id: 'value', label: 'Valor do negócio', description: 'Um valor maior que R$ 0,00' }]);
  });
  it.each([0.01, 1500.25])('accepts an existing positive deal value of %s without asking again', value => {
    expect(getMissingStageFields({ ...deal, value }, stage(['value']), [])).toEqual([]);
  });
  it('keeps zero valid, rejects invalid dates and empty or obsolete choices', () => {
    expect(customStageValueFilled(field('currency'), 0)).toBe(true);
    expect(customStageValueFilled(field('number'), '0')).toBe(true);
    expect(customStageValueFilled(field('number'), ' ')).toBe(false);
    expect(customStageValueFilled(field('number'), 'abc')).toBe(false);
    expect(customStageValueFilled(field('date'), '2026-02-30')).toBe(false);
    expect(customStageValueFilled(field('date'), '2026-10-09')).toBe(true);
    expect(customStageValueFilled(field('multiselect'), [])).toBe(false);
    expect(customStageValueFilled(field('multiselect'), ['A'])).toBe(true);
    expect(customStageValueFilled(field('select'), 'C')).toBe(false);
  });
  it('uses definition IDs and fails closed for unavailable definitions', () => {
    expect(getMissingStageFields({ ...deal, customFields: { field: 0 } }, stage(['custom:f']), [field('number')])).toEqual([]);
    expect(getMissingStageFields(deal, stage(['custom:removed']), [field('number')])[0].unavailable).toBe(true);
  });
});
