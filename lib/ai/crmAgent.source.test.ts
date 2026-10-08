import { describe, expect, it, vi } from 'vitest';
import { formatCockpitSnapshotForPrompt } from './crmAgent';
import { buildDealLeadSourceContext } from '@/lib/deals/leadSourceContext';

vi.mock('./tools', () => ({ createCRMTools: vi.fn() }));

describe('cockpit acquisition source in the assistant prompt', () => {
  it.each([
    [undefined, 'Meta Ads'],
    [null, 'Não informado'],
    ['Indicação', 'Indicação'],
  ])('uses the source of the opportunity (%s), separate from its contact', (leadSource, expected) => {
    const deal = { title: 'Nova oportunidade', ...buildDealLeadSourceContext({ leadSource, customFields: { origem: 'Meta Ads' } }) };
    const prompt = formatCockpitSnapshotForPrompt({ deal, contact: { name: 'João', source: 'Google Ads' } }).join('\n');
    expect(prompt).toContain(`Origem de aquisição do lead: ${expected}`);
    expect(prompt.match(/Origem de aquisição do lead:/g)).toHaveLength(1);
    expect(prompt).not.toContain('Google Ads');
    if (leadSource !== undefined) expect(prompt).not.toContain('Meta Ads');
  });
});
