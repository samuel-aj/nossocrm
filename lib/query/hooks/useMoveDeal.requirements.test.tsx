import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Board, Deal } from '@/types';
import { StageRequirementsContext, type StageCompletionRequest } from '@/features/boards/requirements/StageRequirementsContext';
import { useMoveDeal } from './useMoveDeal';
import { DEALS_VIEW_KEY, queryKeys } from '../queryKeys';

const mocks = vi.hoisted(() => ({ get: vi.fn(), complete: vi.fn(), update: vi.fn(), create: vi.fn(), activity: vi.fn(), contact: vi.fn(), board: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ dealsService: { getById: mocks.get, completeStageMove: mocks.complete, update: mocks.update, create: mocks.create } }));
vi.mock('@/lib/supabase/activities', () => ({ activitiesService: { create: mocks.activity } }));
vi.mock('@/lib/supabase/boards', () => ({ boardsService: { get: mocks.board } }));
vi.mock('@/lib/supabase/contacts', () => ({ contactsService: { update: mocks.contact } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ organizationId: 'org', profile: { first_name: 'Ana' } }) }));
const board = { id: 'board', name: 'Vendas', nextBoardId: 'next', stages: [
  { id: 'lead', label: 'Novo' }, { id: 'signed', label: 'Assinado', linkedLifecycleStage: 'CUSTOMER', requiredFields: ['products'] },
] } as Board;
const deal = { id: 'd', title: 'Lead', organizationId: 'org', boardId: 'board', status: 'lead', contactId: 'contact', items: [], updatedAt: '2026-10-09T10:00:00Z' } as unknown as Deal;
const saved = { ...deal, status: 'signed', isWon: true, closedAt: '2026-10-09T11:00:00Z', lastStageChangeDate: '2026-10-09T11:00:00Z', updatedAt: '2026-10-09T11:00:00Z', items: [{ id: 'i', productId: 'p', name: 'Serviço', price: 300, quantity: 1 }], value: 300 };
beforeEach(() => {
  vi.resetAllMocks(); mocks.get.mockResolvedValue({ data: deal, error: null }); mocks.complete.mockResolvedValue(saved);
  mocks.activity.mockResolvedValue({}); mocks.contact.mockResolvedValue({}); mocks.create.mockResolvedValue({});
  mocks.board.mockResolvedValue({ id: 'next', stages: [{ id: 'entry' }] });
});
function setup(complete: (req: StageCompletionRequest) => Promise<Deal | null>) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const other = { ...deal, id: 'other' };
  client.setQueryData(DEALS_VIEW_KEY, [deal, other]); client.setQueryData(queryKeys.deals.detail(deal.id), deal);
  const hook = renderHook(() => useMoveDeal(), { wrapper: ({ children }) => <QueryClientProvider client={client}><StageRequirementsContext.Provider value={complete}>{children}</StageRequirementsContext.Provider></QueryClientProvider> });
  return { ...hook, client, other, move: () => hook.result.current.mutateAsync({ dealId: deal.id, deal, board, targetStageId: 'signed' }) };
}
it('does not move optimistically, record history, win, copy or promote when cancelled', async () => {
  let close!: (deal: Deal | null) => void;
  const complete = vi.fn(() => new Promise<Deal | null>(resolve => { close = resolve; }));
  const { client, move } = setup(complete);
  let pending!: ReturnType<typeof move>;
  act(() => { pending = move(); });
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toEqual(deal);
  await act(async () => { close(null); expect((await pending).cancelled).toBe(true); });
  expect(mocks.complete).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.activity).not.toHaveBeenCalled(); expect(mocks.contact).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  expect(client.getQueryData(queryKeys.deals.detail(deal.id))).toEqual(deal);
});
it('uses one atomic operation, confirms cache and copies the completed product to the next board', async () => {
  const values = { product: { productId: 'p', price: 300, quantity: 1 } };
  const { client, move, other } = setup(req => req.persist(values));
  await act(async () => { await move(); });
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ deal, values, targetStageId: 'signed', changes: { isWon: true, isLost: false } }));
  expect(mocks.update).not.toHaveBeenCalled();
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)).toEqual([saved, other]);
  expect(client.getQueryData(queryKeys.deals.detail(deal.id))).toEqual(saved);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ items: saved.items, value: 300 })));
});
it('a failure keeps concurrent edits in cache and dispatches no success effects', async () => {
  const { client, move, other } = setup(async req => {
    client.setQueryData(DEALS_VIEW_KEY, [deal, { ...other, title: 'Changed elsewhere' }]);
    return req.persist({});
  });
  mocks.complete.mockRejectedValue(new Error('Missing fields'));
  await act(async () => { await expect(move()).rejects.toThrow('Missing fields'); });
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[1].title).toBe('Changed elsewhere');
  expect(mocks.activity).not.toHaveBeenCalled(); expect(mocks.contact).not.toHaveBeenCalled();
});
it('rejects a stale source stage before opening the modal', async () => {
  mocks.get.mockResolvedValue({ data: { ...deal, status: 'different' }, error: null });
  const complete = vi.fn(); const { move } = setup(complete);
  await act(async () => { await expect(move()).rejects.toThrow('O lead mudou'); });
  expect(complete).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled();
});
