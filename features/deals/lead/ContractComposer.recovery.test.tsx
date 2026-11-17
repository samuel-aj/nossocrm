import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Deal } from '@/types';
import { ContractComposer } from './ContractComposer';

const mock = vi.hoisted(() => ({ toast:vi.fn(), invalidate:vi.fn(), docs:[] as Record<string,unknown>[] }));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({organizationId:'office'})}));
vi.mock('@/context/CRMContext',()=>({useCRM:()=>({boards:[]})}));
vi.mock('@/context/ToastContext',()=>({useToast:()=>({addToast:mock.toast})}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:mock.invalidate})}));
vi.mock('./leadHistoryInvalidation',()=>({invalidateLeadHistory:mock.invalidate}));
vi.mock('./useDealHistory',()=>({dealHistoryKey:(id:string)=>['history',id]}));
vi.mock('@/features/zapsign/useSignatureDraft',()=>({useSignatureDraft:()=>({
  ready:true,emptyVars:[],form:{templateToken:'modelo'},payload:()=>({template_token:'modelo'})
})}));
vi.mock('@/features/zapsign/SignatureFields',()=>({SignatureFields:()=>null}));
vi.mock('@/features/zapsign/signatureTypes',async original=>({
  ...await original<typeof import('@/features/zapsign/signatureTypes')>(),
  useDealSignatures:()=>({data:{connected:true,signatures:mock.docs}})
}));
const deal={id:'lead',status:'stage'} as Deal;
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});

it('recupera o documento anterior pelo ID da tentativa, sem passar pela rota de emissão',async()=>{
  mock.docs=[
    {id:'novo',status:'pending',doc_name:'Contrato',created_at:'2026-11-08'},
    {id:'original',status:'failed',doc_name:'Contrato',created_at:'2026-11-07',can_recover:true}
  ];
  const fetcher=vi.fn().mockResolvedValue(Response.json({signature:{id:'original'}}));
  vi.stubGlobal('fetch',fetcher);
  const view=render(<ContractComposer deal={deal} canEdit={true} />);
  fireEvent.click(screen.getByText('1 documento anterior'));
  fireEvent.click(screen.getByText('Recuperar envelope da ZapSign'));
  await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith('Situação do envelope atualizada.','success'));
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url,init]=fetcher.mock.calls[0];
  expect(url).toBe('/api/integrations/zapsign/deal/lead');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({signature_id:'original',action:'recover'});
  view.rerender(<ContractComposer deal={deal} canEdit={false}/>);
  expect(screen.queryByText('Recuperar envelope da ZapSign')).toBeNull();
});

it('pede conferência antes de repetir uma emissão que ainda não tem referência',async()=>{
  mock.docs=[];
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:'Confira o envelope',unconfirmed_attempts:['original']},{status:409}))
    .mockResolvedValueOnce(Response.json({outcome:{status:'pending',sent_via:'link'}}));
  vi.stubGlobal('fetch',fetcher);
  render(<ContractComposer deal={deal} canEdit={true}/>);
  const button=screen.getByRole('button',{name:'Enviar para assinatura'});
  fireEvent.click(button);
  const check=await screen.findByRole('checkbox');
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(check);
  fireEvent.click(button);
  await waitFor(()=>expect(mock.toast).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[1][1].body).confirmed_absent).toEqual(['original']);
});
