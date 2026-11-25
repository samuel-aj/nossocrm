import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), organization: vi.fn() }));
vi.mock('./client', () => ({ supabase: { from: mocks.from } }));
vi.mock('./orgId', () => ({ getCurrentOrganizationId: mocks.organization, invalidateOrgCache: vi.fn() }));
import { activitiesService } from './activities';

// O lead automático do WhatsApp grava negócio e contato com UUID versão 8.
const autoLeadDealId = 'a1b2c3d4-e5f6-8a7b-9c0d-1e2f3a4b5c6d';
const autoLeadContactId = '0f1e2d3c-4b5a-8697-8877-665544332211';
type NewActivity = Parameters<typeof activitiesService.create>[0];

describe('atividades de leads criados pelo lead automático (id versão 8)', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.organization.mockResolvedValue('current-org'); });

  it('grava o registro "Moveu para ..." ligado ao negócio e ao contato', async () => {
    const row = { id: 'activity', title: 'Moveu para Proposta', type: 'STATUS_CHANGE', date: '2026-11-25T12:00:00.000Z',
      completed: true, deal_id: autoLeadDealId, contact_id: autoLeadContactId };
    const table = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: row, error: null }) };
    mocks.from.mockReturnValue(table);

    const result = await activitiesService.create({ title: row.title, type: 'STATUS_CHANGE', date: row.date, completed: true,
      dealId: autoLeadDealId, contactId: autoLeadContactId } as NewActivity);

    expect(result.error).toBeNull();
    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining({ deal_id: autoLeadDealId, contact_id: autoLeadContactId, organization_id: 'current-org' }));
    expect(result.data).toMatchObject({ dealId: autoLeadDealId, contactId: autoLeadContactId });
  });

  it('mantém negócio e contato ao editar a atividade', async () => {
    const table = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
    mocks.from.mockReturnValue(table);

    expect(await activitiesService.update('activity', { title: 'Ligar amanhã', dealId: autoLeadDealId, contactId: autoLeadContactId })).toEqual({ error: null });

    expect(table.update).toHaveBeenCalledWith({ title: 'Ligar amanhã', deal_id: autoLeadDealId, contact_id: autoLeadContactId });
    expect(table.eq).toHaveBeenCalledWith('id', 'activity');
  });

  it('continua gravando null quando a atividade não tem negócio nem contato', async () => {
    const table = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'activity', title: 'Tarefa solta', type: 'TASK', date: '2026-11-25T12:00:00.000Z', completed: false, deal_id: null, contact_id: null }, error: null }) };
    mocks.from.mockReturnValue(table);

    await activitiesService.create({ title: 'Tarefa solta', type: 'TASK', date: '2026-11-25T12:00:00.000Z', completed: false, dealId: '' } as NewActivity);

    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining({ deal_id: null, contact_id: null }));
  });
});
