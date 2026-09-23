import { describe, expect, it } from 'vitest';
import { dealPatch } from './dealPayload';

describe('external lead payloads', () => {
  it('maps form/Typebot updates including contact, owner and custom fields', () => {
    expect(dealPatch({ id: 'lead', stage_id: 'stage', board_id: 'board', contact_id: 'contact', owner_id: 'owner', custom_fields: { assunto: 'Revisão' }, qualified_at: 'today', inactive_at: null, client_company_id: 'company' }))
      .toEqual({ id: 'lead', status: 'stage', boardId: 'board', contactId: 'contact', ownerId: 'owner', customFields: { assunto: 'Revisão' }, qualifiedAt: 'today', inactiveAt: null, clientCompanyId: 'company', companyId: 'company' });
  });
  it('does not erase joined items or owner labels on a partial update', () => {
    const original = { id: 'lead', items: [{ id: 'product' }], owner: { name: 'Ana' }, customFields: { antigo: 'sim' } };
    expect({ ...original, ...dealPatch({ id: 'lead', custom_fields: { novo: 'sim' } }) })
      .toEqual({ ...original, customFields: { novo: 'sim' } });
  });
  it('preserves explicit clears', () => {
    expect(dealPatch({ id: 'lead', owner_id: null, loss_reason: null, custom_fields: {} }))
      .toEqual({ id: 'lead', ownerId: null, lossReason: null, customFields: {} });
  });
});
