import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Deal, DealView } from '@/types';
import { useBoardsController } from './useBoardsController';
const mocks=vi.hoisted(()=>({
  replace:vi.fn(), fetch:vi.fn(), saveFilters:vi.fn(), setContext:vi.fn(), updateDeal:vi.fn(),
  boards:[{id:'other',name:'Outro funil',stages:[]},{id:'mpl',name:'BPC Autista (Google)',stages:[]}],
  linked:undefined as Deal|undefined, rows:[] as DealView[], automations:vi.fn(), automation:'all',
  conditions:[] as Array<{id:string;field:string;operator:string;value:string}>,
}));
vi.mock('./useBoardAutomations',()=>({useBoardAutomations:(_org:string,_user:string,ids:string[])=>{mocks.automations(ids);return {data:{},loading:false,error:false};}}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams('deal=amanda'),useRouter:()=>({replace:mocks.replace})}));
vi.mock('@/hooks/usePersistedState',()=>({usePersistedState:()=>useState('other')}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({profile:{id:'seller'},organizationId:'org'})}));
vi.mock('@/context/ToastContext',()=>({useToast:()=>({addToast:vi.fn()})}));
vi.mock('@/context/AIContext',()=>({useAI:()=>({setContext:mocks.setContext,clearContext:vi.fn()})}));
vi.mock('@/context/CRMContext',()=>({useCRM:()=>({lifecycleStages:[],customFieldDefinitions:[],contacts:[],availableTags:[],updateDeal:mocks.updateDeal})}));
vi.mock('@/lib/realtime/useRealtimeSync',()=>({useRealtimeSyncKanban:()=>{}}));
vi.mock('@/lib/query/hooks/useOrgPreferences',()=>({useOrgPreferences:()=>({defaultDealStatusFilter:'open',leadSourceOptions:['Presencial']})}));
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
  general:{automation:mocks.automation,status:'open',owner:'mine',tag:'Outro',product:'',logic:'AND',conditions:mocks.conditions},
  period:{preset:'thisMonth',start:'',end:'',created:true,closed:false,logic:'AND'},
  setGeneral:mocks.saveFilters,setPeriod:mocks.saveFilters,loading:false,
})}));
beforeEach(()=>{mocks.rows=[];mocks.conditions=[];mocks.updateDeal.mockClear();mocks.automation='all';mocks.automations.mockClear();mocks.linked=undefined;mocks.replace.mockClear();mocks.saveFilters.mockClear();mocks.fetch.mockClear();});
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

it('filtra pela origem nativa, incluindo limpeza explícita e leads sem campo legado',()=>{
  mocks.rows=[
    {id:'cleared',leadSource:null,customFields:{origem:'Meta Ads'}},
    {id:'changed',leadSource:'Indicação',customFields:{origem:'Meta Ads'}},
    {id:'native-only',leadSource:'Evento',customFields:{}},
  ].map(row=>({...row,boardId:'other',status:'new',isWon:false,isLost:false,ownerId:'seller',tags:['Outro'],createdAt:new Date().toISOString(),items:[]} as DealView));
  mocks.conditions=[{id:'source',field:'origem',operator:'equals',value:'Meta Ads'}];
  const {result,rerender}=renderHook(()=>useBoardsController());
  expect(result.current.filteredDeals).toEqual([]);
  expect(result.current.customFieldOptions.find(option=>option.key==='origem')).toEqual({key:'origem',label:'Origem do lead',kind:'select',options:['Presencial','Indicação','Evento']});
  mocks.conditions=[{id:'source',field:'origem',operator:'empty',value:''}];rerender();
  expect(result.current.filteredDeals.map(deal=>deal.id)).toEqual(['cleared']);
  mocks.conditions=[{id:'source',field:'origem',operator:'equals',value:'Indicação'}];rerender();
  expect(result.current.filteredDeals.map(deal=>deal.id)).toEqual(['changed']);
});

it('limpa origem em massa escrevendo null nativo sem apagar dados legados',()=>{
  mocks.rows=[{id:'lead',boardId:'other',status:'new',isWon:false,isLost:false,ownerId:'seller',tags:['Outro'],createdAt:new Date().toISOString(),items:[],leadSource:'Indicação',customFields:{origem:'Meta Ads',utm_source:'facebook'}} as unknown as DealView];
  const {result}=renderHook(()=>useBoardsController());
  act(()=>result.current.toggleDealSelection('lead'));
  act(()=>result.current.bulkSetCustomField('origem',''));
  expect(mocks.updateDeal).toHaveBeenCalledWith('lead',{leadSource:null});
  expect(mocks.rows[0].customFields).toEqual({origem:'Meta Ads',utm_source:'facebook'});
});
