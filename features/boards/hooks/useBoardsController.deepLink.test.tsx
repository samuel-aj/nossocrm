import { useState } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Deal, DealView } from '@/types';
import { useBoardsController } from './useBoardsController';
const mocks=vi.hoisted(()=>({
  replace:vi.fn(), fetch:vi.fn(), saveFilters:vi.fn(), setContext:vi.fn(),
  boards:[{id:'other',name:'Outro funil',stages:[]},{id:'mpl',name:'BPC Autista (Google)',stages:[]}],
  linked:undefined as Deal|undefined, rows:[] as DealView[], automations:vi.fn(), automation:'all',
}));
vi.mock('./useBoardAutomations',()=>({useBoardAutomations:(_org:string,_user:string,ids:string[])=>{mocks.automations(ids);return {data:{},loading:false,error:false};}}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams('deal=amanda'),useRouter:()=>({replace:mocks.replace})}));
vi.mock('@/hooks/usePersistedState',()=>({usePersistedState:()=>useState('other')}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({profile:{id:'seller'},organizationId:'org'})}));
vi.mock('@/context/ToastContext',()=>({useToast:()=>({addToast:vi.fn()})}));
vi.mock('@/context/AIContext',()=>({useAI:()=>({setContext:mocks.setContext,clearContext:vi.fn()})}));
vi.mock('@/context/CRMContext',()=>({useCRM:()=>({lifecycleStages:[],customFieldDefinitions:[],contacts:[],availableTags:[]})}));
vi.mock('@/lib/realtime/useRealtimeSync',()=>({useRealtimeSyncKanban:()=>{}}));
vi.mock('@/lib/query/hooks/useOrgPreferences',()=>({useOrgPreferences:()=>({defaultDealStatusFilter:'open'})}));
vi.mock('@/lib/query/hooks/useMoveDeal',()=>({useMoveDeal:()=>({mutate:vi.fn()})}));
vi.mock('@/lib/query/hooks/useBoardsQuery',()=>({
  useBoards:()=>({data:mocks.boards,isFetched:true,dataUpdatedAt:1}), useDefaultBoard:()=>({data:mocks.boards[0]}),
  useCreateBoard:()=>({}),useUpdateBoard:()=>({}),useReorderBoards:()=>({}),useDeleteBoard:()=>({}),useDeleteBoardWithMove:()=>({}),useCanDeleteBoard:()=>({}),
}));
vi.mock('@/lib/query/hooks/useDealsQuery',()=>({
  useDealsByBoard:()=>({data:mocks.rows,isLoading:false}),
  useDeal:(id:string)=>{mocks.fetch(id);return {data:mocks.linked};},
}));
vi.mock('../filters/useBoardFilters',()=>({useBoardFilters:()=>({
  general:{automation:mocks.automation,status:'open',owner:'mine',tag:'Outro',product:'',logic:'AND',conditions:[]},
  period:{preset:'thisMonth',start:'',end:'',created:true,closed:false,logic:'AND'},
  setGeneral:mocks.saveFilters,setPeriod:mocks.saveFilters,loading:false,
})}));
beforeEach(()=>{mocks.rows=[];mocks.automation='all';mocks.automations.mockClear();mocks.linked=undefined;mocks.replace.mockClear();mocks.saveFilters.mockClear();mocks.fetch.mockClear();});
it('mantém o lead do relatório selecionado com cache vazio, filtros ativos e outro board salvo',()=>{
  const {result,rerender}=renderHook(()=>useBoardsController());
  expect(result.current.selectedDealId).toBe('amanda');
  expect(result.current.filteredDeals).toEqual([]);
  expect(mocks.fetch).toHaveBeenCalledWith('amanda');
  expect(mocks.replace).not.toHaveBeenCalled();
  mocks.linked={id:'amanda',boardId:'mpl'} as Deal;rerender();
  expect(result.current.activeBoardId).toBe('mpl');
  expect(result.current.selectedDealId).toBe('amanda');
  expect(result.current.filteredDeals).toEqual([]);
  expect(mocks.saveFilters).not.toHaveBeenCalled();
});
it('não seleciona um board fora dos boards acessíveis',()=>{
  mocks.linked={id:'amanda',boardId:'inaccessible'} as Deal;
  const {result}=renderHook(()=>useBoardsController());
  expect(result.current.activeBoardId).toBe('other');
});

it('consulta automações só dos candidatos visíveis sem depender do próprio filtro de automação',()=>{
  mocks.rows=Array.from({length:500},(_,i)=>({
    id:`lead-${i}`,boardId:'other',status:'new',isWon:i>=200,isLost:false,
    ownerId:'seller',tags:['Outro'],createdAt:new Date().toISOString(),items:[],
  } as unknown as DealView));
  mocks.automation='bot';
  const {result}=renderHook(()=>useBoardsController());
  expect(mocks.automations.mock.lastCall?.[0]).toHaveLength(200);
  expect(result.current.filteredDeals).toHaveLength(0); // estados ainda não carregados
});
