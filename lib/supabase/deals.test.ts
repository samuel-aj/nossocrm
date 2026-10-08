import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), organization: vi.fn() }));
vi.mock('./client', () => ({ supabase: { from: mocks.from } }));
vi.mock('./orgId', () => ({ getCurrentOrganizationId: mocks.organization, invalidateOrgCache: vi.fn() }));
import { dealsService } from './deals';

const contactId = '11111111-1111-4111-8111-111111111111';
const dealId = '22222222-2222-4222-8222-222222222222';
function query(result: { data: unknown; error: Error | null }) {
  return { select: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(result) };
}

describe('reassigning a lead contact', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.organization.mockResolvedValue('current-org'); });
  it('requires an active contact visible in the current organization before updating the scoped lead', async () => {
    const contact = query({ data: { id: contactId }, error: null });
    const lead = query({ data: { id: dealId, contact_id: contactId, updated_at: 'confirmed' }, error: null });
    mocks.from.mockImplementation(table => table === 'contacts' ? contact : lead);
    expect(await dealsService.update(dealId, { contactId })).toEqual({ data: { id: dealId, contactId, updatedAt: 'confirmed' }, error: null });
    expect(contact.eq.mock.calls).toEqual([['organization_id', 'current-org'], ['id', contactId]]);
    expect(contact.is).toHaveBeenCalledWith('deleted_at', null);
    expect(lead.eq.mock.calls).toEqual([['organization_id', 'current-org'], ['id', dealId]]);
    expect(lead.is).toHaveBeenCalledWith('deleted_at', null);
    expect(lead.update).toHaveBeenCalledWith(expect.objectContaining({ contact_id: contactId }));
  });
  it('rejects inaccessible, foreign or deleted contacts without writing any lead', async () => {
    mocks.from.mockReturnValue(query({ data: null, error: null }));
    expect((await dealsService.update(dealId, { contactId })).error?.message).toContain('Contato indisponível');
    expect(mocks.from.mock.calls).toEqual([['contacts']]);
  });
  it('does not convert a failed lookup into permission to write', async () => {
    mocks.from.mockReturnValue(query({ data: null, error: new Error('offline') }));
    expect((await dealsService.update(dealId, { contactId })).error?.message).toContain('Não foi possível verificar');
    expect(mocks.from.mock.calls).toEqual([['contacts']]);
  });
  it('rejects malformed contact IDs instead of silently removing the contact', async () => {
    expect((await dealsService.update(dealId, { contactId: 'invalid' })).error?.message).toContain('Contato inválido');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('preserves the existing database edit-permission denial', async () => {
    const denied = new Error('Sem permissão para editar lead');
    mocks.from.mockImplementation(table => query(table === 'contacts' ? { data: { id: contactId }, error: null } : { data: null, error: denied }));
    expect((await dealsService.update(dealId, { contactId })).error).toBe(denied);
  });
  it('does not add a contact lookup to unrelated edits', async () => {
    mocks.from.mockReturnValue(query({ data: { id: dealId, title: 'New title' }, error: null }));
    expect((await dealsService.update(dealId, { title: 'New title' })).error).toBeNull();
    expect(mocks.from.mock.calls).toEqual([['deals']]);
  });
});

describe('native lead source writes', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.organization.mockResolvedValue('current-org'); });
  it.each([undefined, null, '  Feira   local  '])('creates a deal with deliberate source intent %s without rewriting original UTMs', async leadSource => {
    const board = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: contactId, organization_id: dealId }, error: null }) };
    const normalized = leadSource === null ? null : leadSource ? 'Feira local' : 'Meta Ads';
    const lead = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: dealId, lead_source: normalized, lead_source_initialized: true }, error: null }) };
    const items = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) };
    mocks.from.mockImplementation(table => table === 'boards' ? board : table === 'deals' ? lead : items);
    const fields = { origem: 'Meta Ads', utm_campaign: 'Original campaign' };
    const input = { boardId: contactId, title: 'New lead', status: contactId, items: [], customFields: fields, leadSource } as Parameters<typeof dealsService.create>[0];
    const result = await dealsService.create(input);
    expect(result.error).toBeNull();
    expect(result.data?.leadSource).toBe(normalized);
    const payload = lead.insert.mock.calls[0][0];
    expect(payload.custom_fields).toEqual(fields);
    if (leadSource === undefined) {
      expect(payload).not.toHaveProperty('lead_source');
      expect(payload).not.toHaveProperty('lead_source_initialized');
    } else {
      expect(payload).toMatchObject({ lead_source: normalized, lead_source_initialized: true });
    }
  });
  it('sends explicit clear and initialization, then returns authoritative database source for the shared cache', async () => {
    const lead = query({ data: { id: dealId, lead_source: null, lead_source_initialized: true, custom_fields: { origem: 'Meta Ads' } }, error: null });
    mocks.from.mockReturnValue(lead);
    const result = await dealsService.update(dealId, { leadSource: null, customFields: { origem: 'Meta Ads' } });
    expect(lead.update).toHaveBeenCalledWith(expect.objectContaining({ lead_source: null, lead_source_initialized: true, custom_fields: { origem: 'Meta Ads' } }));
    expect(result.data?.leadSource).toBeNull();
  });
  it('omits source fields entirely for unrelated edits, preserving lazy legacy initialization on the server', async () => {
    const lead = query({ data: { id: dealId, lead_source: 'Meta Ads', lead_source_initialized: true }, error: null });
    mocks.from.mockReturnValue(lead);
    expect((await dealsService.update(dealId, { title: 'Edited', leadSource: undefined })).data?.leadSource).toBe('Meta Ads');
    expect(lead.update.mock.calls[0][0]).not.toHaveProperty('lead_source');
    expect(lead.update.mock.calls[0][0]).not.toHaveProperty('lead_source_initialized');
  });
  it('normalizes a custom category but never changes the preserved legacy/UTM object', async () => {
    const lead = query({ data: { id: dealId, lead_source: 'Feira presencial', lead_source_initialized: true }, error: null });
    mocks.from.mockReturnValue(lead);
    const fields = { origem: 'Original', utm_campaign: 'Original campaign' };
    await dealsService.update(dealId, { leadSource: ' Feira\n presencial ', customFields: fields });
    expect(lead.update).toHaveBeenCalledWith(expect.objectContaining({ lead_source: 'Feira presencial', lead_source_initialized: true, custom_fields: fields }));
  });
});
