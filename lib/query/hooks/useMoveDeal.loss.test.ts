import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useMoveDealSimple } from './useMoveDeal';
import { DEALS_VIEW_KEY, queryKeys } from '../queryKeys';
import type { Board, Deal } from '@/types';
const mock = vi.hoisted(() => ({ update: vi.fn(), activity: vi.fn(), contact: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ dealsService: { update: mock.update } }));
vi.mock('@/lib/supabase/activities', () => ({ activitiesService: { create: mock.activity } }));
vi.mock('@/lib/supabase/boards', () => ({ boardsService: {} }));
vi.mock('@/lib/supabase/contacts', () => ({ contactsService: { update: mock.contact } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { first_name: 'Ana' } }) }));
const board = { id: 'board', lostStageId: 'lost', stages: [{ id: 'new', label: 'Novo' }, { id: 'lost', label: 'Perdido' }] } as Board;
const deal = { id: 'lead', title: 'Teste', boardId: 'board', status: 'new', isWon: false, isLost: false } as Deal;
beforeEach(() => { vi.clearAllMocks(); mock.update.mockResolvedValue({ error: null }); mock.activity.mockResolvedValue({ data: { id: 'activity' }, error: null }); });
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(DEALS_VIEW_KEY, [deal]); client.setQueryData(queryKeys.deals.detail(deal.id), deal);
  const hook = renderHook(() => useMoveDealSimple(board), { wrapper: ({ children }) => React.createElement(QueryClientProvider, { client }, children) });
  return { ...hook, client };
}
it('envia perda e classificação juntas e inclui os dois dados no histórico', async () => {
  const { result, client } = setup();
  await act(async () => { await result.current.moveDeal(deal, 'lost', 'Contato repetido', false, true, 'disqualified'); });
  expect(mock.update).toHaveBeenCalledTimes(1);
  expect(mock.update).toHaveBeenCalledWith('lead', expect.objectContaining({ lossCategory: 'disqualified', lossReason: 'Contato repetido', isLost: true, isWon: false }));
  expect(mock.activity).toHaveBeenCalledWith(expect.objectContaining({ description: 'Classificação: Desqualificado\nMotivo da perda: Contato repetido' }));
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toMatchObject({ lossCategory: 'disqualified', lossReason: 'Contato repetido', isLost: true });
  expect(client.getQueryData(queryKeys.deals.lists())).toBeUndefined();
});
it('restaura classificação, motivo e status no cartão e na lista se a perda não for salva', async () => {
  mock.update.mockResolvedValue({ error: new Error('Falha') });
  const { result, client } = setup();
  await act(async () => { await expect(result.current.moveDeal(deal, 'lost', 'Duplicado', false, true, 'disqualified')).rejects.toThrow('Falha'); });
  expect(client.getQueryData(DEALS_VIEW_KEY)).toEqual([deal]);
  expect(client.getQueryData(queryKeys.deals.detail(deal.id))).toEqual(deal);
  expect(mock.activity).not.toHaveBeenCalled();
});
