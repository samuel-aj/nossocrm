// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(()=>({auth:vi.fn(),conn:vi.fn(),read:vi.fn(),get:vi.fn(),signed:vi.fn(),insert:vi.fn(),update:vi.fn()}));
vi.mock('@/lib/whatsapp/api',()=>({ requireOrgUser:h.auth,isOrgAdmin:(r:string)=>r==='admin',json:(b:unknown,s=200)=>Response.json(b,{status:s}) }));
vi.mock('@/lib/whatsapp/service',()=>({getConnectionByIdForOrg:h.conn}));
vi.mock('@/lib/whatsapp/templateMedia',()=>({getTemplateMedia:h.get,readTemplateMedia:h.read}));
import {POST} from './route';
const conn='11111111-1111-4111-8111-111111111111';
const mediaId='22222222-2222-4222-8222-222222222222';
const request=(body:unknown,origin='https://crm.test')=>new Request('https://crm.test/api/message-templates/media',{method:'POST',headers:{'content-type':'application/json','x-forwarded-host':'crm.test',origin},body:JSON.stringify(body)});
const valid={action:'prepare',connectionId:conn,headerType:'image',fileName:'foto.png',mimeType:'image/png',size:10};
beforeEach(()=>{ vi.clearAllMocks();h.conn.mockResolvedValue({id:conn,provider:'meta_cloud'});h.insert.mockResolvedValue({error:null});h.signed.mockResolvedValue({data:{path:'server-owned',token:'upload-token'}});h.auth.mockResolvedValue({ok:true,user:{role:'admin',organizationId:'org'},admin:{from:()=>({insert:h.insert}),storage:{from:()=>({createSignedUploadUrl:h.signed})}}}); });
it('issues a scoped non-upsert upload token without passing bytes through app',async()=>{const res=await POST(request(valid));expect(res.status).toBe(200);expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({organization_id:'org',connection_id:conn,storage_path:expect.stringMatching(/^org\/111/)}));expect(h.signed.mock.calls[0]).toHaveLength(1);expect(h.read).not.toHaveBeenCalled();});
it.each([{...valid,size:6*1024*1024},{...valid,mimeType:'image/svg+xml'},{...valid,url:'http://169.254.169.254'},{...valid,storage_path:'other-org/a.png'}])('rejects size MIME and arbitrary URL/path',async body=>{expect((await POST(request(body))).status).toBe(422);expect(h.signed).not.toHaveBeenCalled();});
it('rejects another tenant connection',async()=>{h.conn.mockResolvedValue(null);expect((await POST(request(valid))).status).toBe(422);expect(h.insert).not.toHaveBeenCalled();});
it('requires admin and same origin',async()=>{expect((await POST(request(valid,'https://evil.test'))).status).toBe(403);h.auth.mockResolvedValue({ok:true,user:{role:'agent'},admin:{}});expect((await POST(request(valid))).status).toBe(403);expect(h.signed).not.toHaveBeenCalled();});
it('rejects another org media before storage download',async()=>{h.get.mockRejectedValue(new Error('Mídia não encontrada'));expect((await POST(request({action:'complete',connectionId:conn,mediaId}))).status).toBe(422);expect(h.read).not.toHaveBeenCalled();});
it('rejects actual bytes mismatch before recording completion',async()=>{h.get.mockResolvedValue({id:mediaId});h.read.mockRejectedValue(new Error('Formato inválido'));expect((await POST(request({action:'complete',connectionId:conn,mediaId}))).status).toBe(422);expect(h.update).not.toHaveBeenCalled();});
