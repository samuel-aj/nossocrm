import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Board } from '@/types';
const mocks = vi.hoisted(() => ({ invalidate: vi.fn(), on: vi.fn(), subscribe: vi.fn(), remove: vi.fn(), channel: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'seller' }, organizationId: 'org', loading: false }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { channel: mocks.channel, removeChannel: mocks.remove } }));
vi.mock('@/lib/supabase/orgId', () => ({ getCurrentOrganizationId: vi.fn() }));
import { usePerformanceReport } from './usePerformanceReport';
it('atualiza o relatório ao receber movimentação da organização e remove a inscrição ao sair', () => {
  const channel={on:mocks.on,subscribe:mocks.subscribe};
  mocks.channel.mockReturnValue(channel);mocks.on.mockReturnValue(channel);mocks.subscribe.mockReturnValue(channel);
  const {unmount}=renderHook(()=>usePerformanceReport({id:'board'} as Board,{start:new Date('2026-08-01'),end:new Date('2026-08-31')},''));
  expect(mocks.on.mock.calls[0][1]).toMatchObject({table:'deals',filter:'organization_id=eq.org'});
  mocks.on.mock.calls[0][2]({eventType:'UPDATE',new:{stage_id:'proposal'}});
  expect(mocks.invalidate).toHaveBeenCalledWith({queryKey:['performance-report','org']});
  unmount();expect(mocks.remove).toHaveBeenCalledWith(channel);
});
