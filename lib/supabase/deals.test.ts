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
