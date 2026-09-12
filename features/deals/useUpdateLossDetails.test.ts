import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@/types';
import { DEALS_VIEW_KEY, queryKeys } from '@/lib/query/queryKeys';
import { useUpdateLossDetails } from './useUpdateLossDetails';
const mocks = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), eq: vi.fn(), is: vi.fn(), select: vi.fn(), single: vi.fn(), create: vi.fn(), org: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { first_name: 'Samuel' }, organizationId: 'org' }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/lib/supabase/activities', () => ({ activitiesService: { create: mocks.create } }));
vi.mock('@/lib/supabase/orgId', () => ({ getCurrentOrganizationId: mocks.org }));
const deal = { id: 'lead', title: 'Teste', boardId: 'board', status: 'lost-stage', isLost: true, isWon: false, value: 100,
  lossCategory: 'qualified', lossReason: 'Preço', closedAt: '2026-09-03', qualifiedAt: '2026-08-02', updatedAt: '2026-09-03' } as Deal;
const updates = { lossCategory: 'disqualified' as const, lossReason: '  Contato repetido  ' };
beforeEach(() => {
  vi.clearAllMocks();
  const query = { update: mocks.update, eq: mocks.eq, is: mocks.is, select: mocks.select, single: mocks.single };
  for (const fn of [mocks.from, mocks.update, mocks.eq, mocks.is, mocks.select]) fn.mockReturnValue(query);
  mocks.single.mockResolvedValue({ data: { id: 'lead', updated_at: '2026-09-11' }, error: null });
  mocks.org.mockResolvedValue('org'); mocks.create.mockResolvedValue({ data: { id: 'event' }, error: null });
});
function setup(canEdit = true, value = deal) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(DEALS_VIEW_KEY, [value]); client.setQueryData(queryKeys.deals.detail(value.id), value);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useUpdateLossDetails(value, canEdit), { wrapper: ({ children }) => React.createElement(QueryClientProvider, { client }, children) });
  return { ...hook, client, invalidate };
}
describe('correção dos dados de perda', () => {
  it('salva somente classificação/motivo e registra antes/depois sem mudar o encerramento', async () => {
    const { result, client, invalidate } = setup();
    await act(async () => { await result.current.mutateAsync(updates); });
    expect(mocks.update).toHaveBeenCalledWith({ loss_category: 'disqualified', loss_reason: 'Contato repetido' });
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', 'org');
    expect(mocks.eq).toHaveBeenCalledWith('is_lost', true);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Samuel corrigiu os dados da perda', description: expect.stringContaining('Antes:\nClassificação: Qualificado\nMotivo da perda: Preço\n\nDepois:\nClassificação: Desqualificado') }));
    expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toMatchObject({ ...deal, lossCategory: 'disqualified', lossReason: 'Contato repetido', updatedAt: '2026-09-11' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['performance-report', 'org'] });
  });
  it('não registra histórico nem altera cache se a atualização falhar ou o lead já foi reaberto', async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: 'No rows' } });
    const { result, client } = setup();
    await act(async () => { await expect(result.current.mutateAsync(updates)).rejects.toThrow('Não foi possível salvar'); });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(client.getQueryData(DEALS_VIEW_KEY)).toEqual([deal]);
  });
  it('bloqueia sem permissão e impede atualização em organização diferente', async () => {
    const noAccess = setup(false);
    await act(async () => { await expect(noAccess.result.current.mutateAsync(updates)).rejects.toThrow('Sem permissão'); });
    const wrongOrg = setup(); mocks.org.mockResolvedValue('other');
    await act(async () => { await expect(wrongOrg.result.current.mutateAsync(updates)).rejects.toThrow('Organização'); });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('sinaliza falha parcial de histórico sem fingir que a edição falhou', async () => {
    mocks.create.mockResolvedValue({ data: null, error: new Error('Histórico indisponível') });
    const { result } = setup();
    await act(async () => { expect(await result.current.mutateAsync(updates)).toMatchObject({ historyWarning: true }); });
  });
});
