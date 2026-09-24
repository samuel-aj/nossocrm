import { beforeEach, expect, it, vi } from 'vitest';
import { createMetaTemplate, listMetaTemplates } from './templates';
vi.mock('./index',()=>({envEvolution:()=>({})}));
const conn={ provider:'meta_cloud', meta_waba_id:'waba', instance_token:'secret', instance_name:'instance', base_url:null };
const input={name:'hello',category:'UTILITY' as const,language:'pt_BR',bodyText:'Hello',examples:[]};
beforeEach(()=>vi.unstubAllGlobals());
it.each(['image','video','document'] as const)('creates %s HEADER approval sample before BODY',async type=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({})}); vi.stubGlobal('fetch',fetcher);
 await createMetaTemplate(conn,{...input,header:{type,handle:'sample'}});
 expect(JSON.parse(fetcher.mock.calls[0][1].body).components).toEqual([{type:'HEADER',format:type.toUpperCase(),example:{header_handle:['sample']}},{type:'BODY',text:'Hello'}]);
});
it('keeps text-only creation unchanged',async()=>{const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetcher);await createMetaTemplate(conn,input);expect(JSON.parse(fetcher.mock.calls[0][1].body).components).toEqual([{type:'BODY',text:'Hello'}]);});
it('sync keeps media format without trusting remote example URLs',async()=>{const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:[{name:'hello',components:[{type:'HEADER',format:'VIDEO',example:{header_handle:['http://169.254.169.254/']}},{type:'BODY',text:'Hello'}]}]})});vi.stubGlobal('fetch',fetcher);expect((await listMetaTemplates(conn)).templates[0]).toMatchObject({headerType:'video',bodyText:'Hello'});expect(fetcher).toHaveBeenCalledTimes(1);});
