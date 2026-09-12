import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { getCurrentOrganizationId } from '@/lib/supabase/orgId';
import type { Board } from '@/types';
const mocks = vi.hoisted(() => ({ invalidate: vi.fn(), on: vi.fn(), subscribe: vi.fn(), remove: vi.fn(), channel: vi.fn(), from: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'seller' }, organizationId: 'org', loading: false }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { channel: mocks.channel, removeChannel: mocks.remove, from: mocks.from } }));
vi.mock('@/lib/supabase/orgId', () => ({ getCurrentOrganizationId: vi.fn() }));
import { usePerformanceReport } from './usePerformanceReport';
beforeEach(() => { vi.clearAllMocks(); const channel = { on: mocks.on, subscribe: mocks.subscribe }; mocks.channel.mockReturnValue(channel); mocks.on.mockReturnValue(channel); mocks.subscribe.mockReturnValue(channel); });
it('atualiza o relatório ao receber movimentação da organização e remove a inscrição ao sair', () => {
  const channel={on:mocks.on,subscribe:mocks.subscribe};
  mocks.channel.mockReturnValue(channel);mocks.on.mockReturnValue(channel);mocks.subscribe.mockReturnValue(channel);
  const {unmount}=renderHook(()=>usePerformanceReport({id:'board'} as Board,{start:new Date('2026-08-01'),end:new Date('2026-08-31')},''));
  expect(mocks.on.mock.calls[0][1]).toMatchObject({table:'deals',filter:'organization_id=eq.org'});
  mocks.on.mock.calls[0][2]({eventType:'UPDATE',new:{stage_id:'proposal'}});
  expect(mocks.invalidate).toHaveBeenCalledWith({queryKey:['performance-report','org']});
  unmount();expect(mocks.remove).toHaveBeenCalledWith(channel);
});

it('carrega os produtos sob RLS, inclui filtro na chave e calcula apenas os negócios vinculados', async () => {
  vi.mocked(getCurrentOrganizationId).mockResolvedValue('org');
  const filters: unknown[][] = [];
  const tables: Record<string, unknown[]> = {
    deals: [{ id: 'a', board_id: 'board', title: 'A', stage_id: 'won', created_at: '2026-08-01', closed_at: '2026-08-05', is_won: true, value: 350 }, { id: 'b', board_id: 'board', title: 'B', stage_id: 'won', created_at: '2026-08-01', closed_at: '2026-08-05', is_won: true, value: 900 }],
    deal_items: [{ id: 'i1', deal_id: 'a', product_id: 'product', name: 'Produto A', quantity: 1, price: 350 }],
  };
  mocks.from.mockImplementation((table: string) => {
    let offset = 0;
    const query: any = { then: (resolve: (data: unknown) => unknown) => Promise.resolve(resolve({ data: (tables[table] || []).slice(offset, offset + 1000), error: null })) };
    for (const method of ['select', 'eq', 'is', 'order', 'in']) query[method] = (...args: unknown[]) => { filters.push([table, method, ...args]); return query; };
    query.range = (from: number) => { offset = from; return query; };
    return query;
  });
  const board = { id: 'board', wonStageId: 'won', stages: [{ id: 'won', label: 'Ganho' }] } as Board;
  renderHook(() => usePerformanceReport(board, { start: new Date('2026-08-01'), end: new Date('2026-08-31') }, '', undefined, 'product'));
  const options = vi.mocked(useQuery).mock.calls.at(-1)![0] as unknown as { queryKey: unknown[]; queryFn: () => Promise<any> };
  expect(options.queryKey.at(-1)).toBe('product');
  const data = await options.queryFn();
  expect(data.wonRevenue).toBe(350);
  expect(data.deals.map((deal: { id: string }) => deal.id)).toEqual(['a']);
  expect(data.productOptions).toEqual([{ id: 'product', name: 'Produto A' }]);
  expect(filters).toContainEqual(['deal_items', 'eq', 'organization_id', 'org']);
  expect(filters).toContainEqual(['deal_items', 'in', 'deal_id', ['a', 'b']]);
  expect(filters).toContainEqual(['deal_stage_events', 'in', 'deal_id', ['a']]);
  const productsSubscription = mocks.on.mock.calls.find(call => call[1].table === 'deal_items')!;
  productsSubscription[2]();
  expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['performance-report', 'org'] });
});
