import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Board, Deal } from '@/types';
import { useMoveDeal } from './useMoveDeal';
import { DEALS_VIEW_KEY, queryKeys } from '../queryKeys';

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), activity: vi.fn(), contact: vi.fn(), getBoard: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ dealsService: { update: mocks.update, create: mocks.create } }));
vi.mock('@/lib/supabase/activities', () => ({ activitiesService: { create: mocks.activity } }));
vi.mock('@/lib/supabase/boards', () => ({ boardsService: { get: mocks.getBoard } }));
vi.mock('@/lib/supabase/contacts', () => ({ contactsService: { update: mocks.contact } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { first_name: 'Ana' } }) }));
const board = { id: 'sales', name: 'Vendas', wonStageId: 'protocol', nextBoardId: 'service', stages: [
  { id: 'lead', label: 'Novo' }, { id: 'contract', label: 'Contrato', linkedLifecycleStage: 'CUSTOMER' },
  { id: 'second-customer', label: 'Cliente confirmado', linkedLifecycleStage: 'CUSTOMER' },
  { id: 'protocol', label: 'Protocolado' },
] } as Board;
const deal = { id: 'deal', title: 'Lead', boardId: 'sales', status: 'lead', contactId: 'contact', isWon: false, isLost: false, lastStageChangeDate: '2026-09-01T12:00:00Z' } as Deal;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.update.mockResolvedValue({ error: null });
  mocks.activity.mockResolvedValue({ error: null });
  mocks.contact.mockResolvedValue({ error: null });
  mocks.create.mockResolvedValue({ error: null });
  mocks.getBoard.mockResolvedValue({ id: 'service', name: 'Atendimento', stages: [{ id: 'entry', label: 'Entrada' }] });
});
function setup(current = deal) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const other = { ...deal, id: 'other-deal', status: 'lead' };
  client.setQueryData(DEALS_VIEW_KEY, [current, other]);
  client.setQueryData(queryKeys.deals.detail(current.id), current);
  const hook = renderHook(() => useMoveDeal(), { wrapper: ({ children }) => React.createElement(QueryClientProvider, { client }, children) });
  const move = (targetStageId: string, overrides = {}) => hook.result.current.mutateAsync({ dealId: current.id, deal: current, board, targetStageId, ...overrides });
  return { ...hook, client, move, other };
}

it('wins at Customer, adopts the authoritative date and automates only this deal', async () => {
  const confirmed = { isWon: true, isLost: false, closedAt: '2026-10-08T16:01:23Z' };
  mocks.update.mockResolvedValue({ data: confirmed, error: null });
  const { client, move, other } = setup();
  await act(async () => { await move('contract'); });
  expect(mocks.update).toHaveBeenCalledWith('deal', expect.objectContaining({ status: 'contract', isWon: true, isLost: false }));
  expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('closedAt');
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toMatchObject(confirmed);
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[1]).toEqual(other);
  expect(client.getQueryData(queryKeys.deals.detail('deal'))).toMatchObject(confirmed);
  expect(client.getQueryData(queryKeys.deals.lists())).toBeUndefined();
  expect(mocks.contact).toHaveBeenCalledExactlyOnceWith('contact', { stage: 'CUSTOMER' });
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
});

it('does not win or copy a lead that jumps straight to Protocolado', async () => {
  const { move, client } = setup();
  await act(async () => { await move('protocol'); });
  expect(mocks.update).toHaveBeenCalledWith('deal', expect.objectContaining({ isWon: false, isLost: false }));
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0].isWon).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.getBoard).not.toHaveBeenCalled();
});

it.each(['second-customer', 'protocol'])('preserves the episode date without copying again at %s', async target => {
  const current = { ...deal, status: 'contract', isWon: true, closedAt: '2026-09-20T12:00:00Z' };
  mocks.update.mockResolvedValue({ data: { isWon: true, isLost: false, closedAt: current.closedAt }, error: null });
  const { move, client } = setup(current);
  await act(async () => { await move(target); });
  expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('closedAt');
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toMatchObject({ isWon: true, closedAt: current.closedAt });
  expect(mocks.getBoard).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});

it.each([undefined, '2026-09-20T12:00:00Z'])('lets the database recover a legacy Customer win dated %s without new automation', async closedAt => {
  mocks.update.mockResolvedValue({ data: { isWon: true, isLost: false, closedAt, lastStageChangeDate: '2026-10-08T16:01:23Z' }, error: null });
  const { move, client } = setup({ ...deal, status: 'contract' });
  await act(async () => { await move('protocol'); });
  expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('isWon');
  expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('closedAt');
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toMatchObject({ isWon: true, closedAt });
  expect(mocks.create).not.toHaveBeenCalled();
});

it('automates one new gain after a Customer-stage reopening only when the database proves a fresh episode', async () => {
  const date = '2026-10-08T16:01:23Z';
  mocks.update.mockResolvedValue({ data: { isWon: true, isLost: false, closedAt: date, lastStageChangeDate: date }, error: null });
  const { move, client } = setup({ ...deal, status: 'contract', isWon: false });
  await act(async () => { await move('second-customer'); });
  expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('isWon');
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toMatchObject({ isWon: true, closedAt: date });
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
});

it('explicitly reopens in the same Customer column without repromoting the contact or changing its entry date', async () => {
  const current = { ...deal, status: 'contract', isWon: true, closedAt: '2026-09-20T12:00:00Z' };
  mocks.update.mockResolvedValue({ data: { isWon: false, isLost: false, closedAt: undefined }, error: null });
  const { move, client } = setup(current);
  await act(async () => { await move('contract', { explicitReopen: true }); });
  expect(mocks.update.mock.calls[0][1]).toMatchObject({ isWon: false, isLost: false });
  expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('lastStageChangeDate');
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toMatchObject({ isWon: false, closedAt: undefined, lastStageChangeDate: current.lastStageChangeDate });
  expect(mocks.contact).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});

it('never fabricates an optimistic close date and ignores stale confirmation after a subsequent move', async () => {
  let finish!: (value: unknown) => void;
  mocks.update.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { move, client } = setup();
  let pending!: ReturnType<typeof move>;
  act(() => { pending = move('contract'); });
  await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toMatchObject({ isWon: true, closedAt: undefined });
  client.setQueryData<Deal[]>(DEALS_VIEW_KEY, old => old?.map(item => item.id === 'deal' ? { ...item, status: 'lead', isWon: false } : item));
  client.setQueryData<Deal>(queryKeys.deals.detail('deal'), old => old && { ...old, status: 'lead', isWon: false });
  await act(async () => { finish({ data: { isWon: true, closedAt: '2026-10-08T16:01:23Z' }, error: null }); await pending; });
  expect(client.getQueryData<Deal[]>(DEALS_VIEW_KEY)?.[0]).toMatchObject({ status: 'lead', isWon: false, closedAt: undefined });
  expect(client.getQueryData(queryKeys.deals.detail('deal'))).toMatchObject({ status: 'lead', isWon: false, closedAt: undefined });
});


it.each([
  [{ leadSource: 'Google Ads', customFields: { origem: 'Meta Ads' } }, 'Google Ads'],
  [{ leadSource: null, customFields: { origem: 'Meta Ads' } }, null],
  [{ customFields: { origem: 'Meta Ads' } }, 'Meta Ads'],
])('preserves acquisition when copying the same deal to the next board: %j', async (source, expected) => {
  mocks.update.mockResolvedValue({ data: { isWon: true, closedAt: '2026-10-08T16:01:23Z' }, error: null });
  const { move } = setup({ ...deal, ...source });
  await act(async () => { await move('contract'); });
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ leadSource: expected, boardId: 'service' });
});
