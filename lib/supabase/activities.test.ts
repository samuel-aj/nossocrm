import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('vínculo preenchido que não é um id', () => {
  // Negócio e contato ficam com id provisório enquanto a tela espera o servidor.
  const provisionalId = 'temp-1732540000000';
  const call = { title: 'Ligação', type: 'CALL', date: '2026-11-25T12:00:00.000Z', completed: true };
  beforeEach(() => { vi.clearAllMocks(); mocks.organization.mockResolvedValue('current-org'); vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['o negócio ainda está sendo salvo', { dealId: provisionalId }, 'identificar o lead'],
    ['o negócio é o fictício do modo Foco', { dealId: `placeholder-${autoLeadContactId}` }, 'identificar o lead'],
    ['o contato ainda está sendo salvo', { dealId: autoLeadDealId, contactId: provisionalId }, 'identificar o contato'],
  ])('devolve erro e não grava a atividade solta quando %s', async (_label, links, message) => {
    const result = await activitiesService.create({ ...call, ...links } as NewActivity);

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(message);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.organization).not.toHaveBeenCalled();
  });

  it.each([
    ['negócio', { dealId: provisionalId }, 'identificar o lead'],
    ['contato', { contactId: provisionalId }, 'identificar o contato'],
  ])('devolve erro em vez de apagar o %s ao editar', async (_label, links, message) => {
    const result = await activitiesService.update('activity', { title: 'Ligar amanhã', ...links });

    expect(result.error?.message).toContain(message);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('continua desvinculando ao editar quando o campo vem vazio', async () => {
    const table = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
    mocks.from.mockReturnValue(table);

    expect(await activitiesService.update('activity', { dealId: '', contactId: '' })).toEqual({ error: null });

    expect(table.update).toHaveBeenCalledWith({ deal_id: null, contact_id: null });
  });

  it('não toca nos vínculos quando a edição não os envia', async () => {
    const table = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
    mocks.from.mockReturnValue(table);

    expect(await activitiesService.update('activity', { completed: true })).toEqual({ error: null });

    expect(table.update).toHaveBeenCalledWith({ completed: true });
  });

  it.each([
    ['negócio sem contato (o registro "Moveu para ...")', { dealId: autoLeadDealId }, { deal_id: autoLeadDealId, contact_id: null }],
    ['negócio com contato vazio (tela de Atividades)', { dealId: autoLeadDealId, contactId: '' }, { deal_id: autoLeadDealId, contact_id: null }],
    ['contato sem negócio (reativação na Inbox)', { dealId: '', contactId: autoLeadContactId }, { deal_id: null, contact_id: autoLeadContactId }],
  ])('grava só o vínculo informado: %s', async (_label, links, written) => {
    const table = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'activity', ...call, ...written }, error: null }) };
    mocks.from.mockReturnValue(table);

    const result = await activitiesService.create({ ...call, ...links } as NewActivity);

    expect(result.error).toBeNull();
    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining(written));
  });

  it.each([
    ['negócio', { dealId: '00000000-0000-9000-8000-000000000001' }, { deal_id: '00000000-0000-9000-8000-000000000001' }],
    ['contato', { contactId: '00000000-0000-9000-8000-000000000002' }, { contact_id: '00000000-0000-9000-8000-000000000002' }],
  ])('ao editar só o %s, mantém o id de versão desconhecida e não toca no outro vínculo', async (_label, links, written) => {
    const table = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
    mocks.from.mockReturnValue(table);

    expect(await activitiesService.update('activity', links)).toEqual({ error: null });

    expect(table.update).toHaveBeenCalledWith(written);
  });

  // "O banco decide": o id tem formato de UUID, o registro não existe, e o erro do banco é devolvido.
  it('repassa o erro do banco quando o registro do vínculo não existe', async () => {
    const refused = Object.assign(new Error('violates foreign key constraint "activities_deal_id_fkey"'), { code: '23503' });
    const table = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: refused }) };
    mocks.from.mockReturnValue(table);

    const result = await activitiesService.create({ ...call, dealId: '00000000-0000-9000-8000-000000000001' } as NewActivity);

    expect(result.data).toBeNull();
    expect(result.error).toBe(refused);
    expect(table.insert).toHaveBeenCalledTimes(1);
  });

  // A tela não pode soltar um vínculo só porque não conhece a versão do id: o banco decide.
  it('grava o vínculo de um id com versão que o validador da tela não conhece', async () => {
    const unknownVersionDealId = '00000000-0000-9000-8000-000000000001';
    const unknownVersionContactId = '00000000-0000-9000-8000-000000000002';
    const table = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'activity', ...call, deal_id: unknownVersionDealId, contact_id: unknownVersionContactId }, error: null }) };
    mocks.from.mockReturnValue(table);

    const result = await activitiesService.create({ ...call, dealId: unknownVersionDealId, contactId: unknownVersionContactId } as NewActivity);

    expect(result.error).toBeNull();
    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining({ deal_id: unknownVersionDealId, contact_id: unknownVersionContactId }));
  });
});
