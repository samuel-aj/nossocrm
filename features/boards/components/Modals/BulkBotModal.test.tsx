import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({organizationId:'org'}) }));
vi.mock('@/components/ui/Modal', () => ({ Modal: ({ children, footer }: {children:React.ReactNode;footer:React.ReactNode}) => <div>{children}{footer}</div> }));
import { BulkBotModal } from './BulkBotModal';
afterEach(()=>vi.unstubAllGlobals());
describe('bulk robot confirmation', () => {
 it('reviews recipients before starting and shows the queue result', async () => {
  const calls: {preview: boolean; batchId: string}[]=[];
  vi.stubGlobal('fetch',vi.fn(async (url:string,init?:RequestInit)=>{
   if(url==='/api/wa-agents/bots') return Response.json({bots:[{id:'bot',name:'Follow-up',enabled:true}]});
   if(init?.method==='POST') { const body=JSON.parse(init.body as string);calls.push(body);return Response.json({botName:'Follow-up',recipients:[{dealId:'lead',title:'Teste',eligible:true,phone:'+12025550123'}],...(body.preview?{}:{results:[{dealId:'lead',status:'queued',runId:'run'}]})}); }
   return Response.json({runs:[{id:'run',deal_id:'lead',status:'done',error:null}]});
  }));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><BulkBotModal dealIds={['lead']} onClose={()=>{}} /></QueryClientProvider>);
  await screen.findByText('Follow-up');
  fireEvent.change(screen.getByLabelText('Robô'),{target:{value:'bot'}});
  fireEvent.click(screen.getByRole('button',{name:'Revisar destinatários'}));
  await screen.findByRole('button',{name:'Confirmar execução (1)'});
  expect(calls).toHaveLength(1);expect(calls[0].preview).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Confirmar execução (1)'}));
  await waitFor(()=>expect(screen.getByText(/execuções na fila/)).toBeTruthy());
  expect(calls).toHaveLength(2);expect(calls[1].preview).toBe(false);expect(calls[1].batchId).toBe(calls[0].batchId);
  await screen.findByText(/Concluído/);
 });
});
