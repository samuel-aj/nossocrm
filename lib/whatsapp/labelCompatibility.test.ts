import { describe, expect, it } from 'vitest';
import { legacyTagColor, catalogColor, labelDelta, linkedDeal } from './labelCompatibility';
import { normalizeLabelName } from './labels';

describe('shared label compatibility', () => {
  it('preserves existing long names rather than truncating into another label', () => {
    const name = 'Cliente ' + 'a'.repeat(90);
    expect(normalizeLabelName(` ${name} `)).toBe(name);
  });
  it('maps both CSS and canonical colors', () => {
    expect(catalogColor('bg-blue-500')).toBe('blue');
    expect(catalogColor('bg-emerald-500')).toBe('green');
    expect(catalogColor('purple')).toBe('purple');
    expect(legacyTagColor('purple')).toBe('bg-violet-500');
  });
  it('sends only intended additions/removals from the edit snapshot', () => {
    expect(labelDelta(['a', 'b'], ['b', 'c'])).toEqual({ addLabelIds: ['c'], removeLabelIds: ['a'] });
  });
  it('never picks another lead for an unlinked conversation or a group', () => {
    const deals = [{ id: 'a' }, { id: 'b' }];
    expect(linkedDeal(deals, null, false)).toBeNull();
    expect(linkedDeal(deals, 'b', false)).toEqual({ id: 'b' });
    expect(linkedDeal(deals, 'b', true)).toBeNull();
    expect(linkedDeal(deals, 'missing', false)).toBeNull();
  });
});
