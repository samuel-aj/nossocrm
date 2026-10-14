import { afterEach, expect, it, vi } from 'vitest';
import { EvolutionProvider } from './evolution';
import { MetaCloudProvider } from './metaCloud';
import { getProvider } from '../index';
import type { WaConnectionRow } from '../service';

afterEach(()=>vi.unstubAllGlobals());
const text='  Olá, João!\n\n*Roteiro aprovado* → 😊\n';
const config={baseUrl:'https://provider.test',instanceName:'test-instance',token:'test-token',phoneNumberId:'123'};
it('preserves exact Unicode and caller deadline in Evolution wire payload',async()=>{
  const fetcher=vi.fn(async()=>Response.json({key:{id:'evo-1'}}));vi.stubGlobal('fetch',fetcher);
  const signal=new AbortController().signal;
  const result=await new EvolutionProvider(config).sendText({to:'12000@g.us',isGroup:true,text,signal});
  expect(result.providerMessageId).toBe('evo-1');
  const call=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(JSON.parse(String(call[1].body))).toMatchObject({text,number:'12000@g.us'});expect(call[1].signal).toBe(signal);
});
it('preserves Meta text and uploads PDF bytes/filename before sending its media ID',async()=>{
  const pdf=Buffer.from('%PDF-1.7\nfixture');
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({messages:[{id:'meta-text'}]}))
    .mockResolvedValueOnce(new Response(pdf,{headers:{'content-type':'application/pdf'}}))
    .mockResolvedValueOnce(Response.json({id:'meta-media'})).mockResolvedValueOnce(Response.json({messages:[{id:'meta-document'}]}));
  vi.stubGlobal('fetch',fetcher);const provider=new MetaCloudProvider(config);const signal=new AbortController().signal;
  await provider.sendText({to:'+5511999990000',text,signal});
  expect(JSON.parse(fetcher.mock.calls[0][1].body).text.body).toBe(text);
  const result=await provider.sendMedia({to:'test-group',isGroup:true,kind:'document',media:'https://storage.test/sealed.pdf',mimeType:'application/pdf',fileName:'Revisão.pdf',caption:'*Confira* → 😊',signal});
  expect(result.providerMessageId).toBe('meta-document');
  const file=fetcher.mock.calls[2][1].body.get('file') as File;
  expect(file.name).toBe('Revisão.pdf');expect(Buffer.from(await file.arrayBuffer())).toEqual(pdf);
  expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({recipient_type:'group',to:'test-group',document:{id:'meta-media',filename:'Revisão.pdf',caption:'*Confira* → 😊'}});
  for(const call of fetcher.mock.calls)expect(call[1].signal).toBe(signal);
});
it('selects the configured provider including evolution_business',()=>{
  const connection={instance_name:'test',instance_token:'test',base_url:'https://provider.test',meta_phone_number_id:'123'};
  expect(getProvider({...connection,provider:'evolution'} as WaConnectionRow)).toBeInstanceOf(EvolutionProvider);
  expect(getProvider({...connection,provider:'evolution_business'} as WaConnectionRow)).toBeInstanceOf(EvolutionProvider);
  expect(getProvider({...connection,provider:'meta_cloud'} as WaConnectionRow)).toBeInstanceOf(MetaCloudProvider);
});
