import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({sendText:vi.fn(),sendTemplate:vi.fn(),record:vi.fn(),agent:null as string|null,auth:true}));
vi.mock('@/lib/public-api/auth',()=>({authPublicApi:async()=>m.auth?{ok:true,organizationId:'org'}:{ok:false,status:401,body:{error:'Unauthorized'}}}));
vi.mock('@/lib/supabase/server',()=>({createStaticAdminClient:()=>({from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{ai_status:m.agent},error:null})};return q;}})}));
vi.mock('@/lib/whatsapp',()=>({getProvider:()=>({sendText:m.sendText,sendTemplate:m.sendTemplate})}));
vi.mock('@/lib/whatsapp/service',()=>({getConnectionByOrg:async()=>({id:'connection',status:'connected'}),getConnectionByIdForOrg:async()=>({id:'connection',status:'connected'}),ensureConversation:async()=>({id:'conversation'}),recordOutboundMessage:m.record,replicateOutboundToSiblings:vi.fn()}));
import { POST } from './route';
const req=(extra={})=>new Request('https://crm.test/api/public/v1/whatsapp/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:'+5511999990000',text:'Olá',...extra})});
beforeEach(()=>{vi.clearAllMocks();m.auth=true;m.agent=null;m.sendText.mockResolvedValue({ok:true,providerMessageId:'provider'});m.sendTemplate.mockResolvedValue({ok:true,providerMessageId:'template'});m.record.mockImplementation(async(_a,r)=>({id:'message',status:r.status,body:r.text,evolution_message_id:r.providerMessageId}));});
it('preserves public API response, API attribution and shared history',async()=>{
  const response=await POST(req());expect(response.status).toBe(201);expect(await response.json()).toMatchObject({ok:true,message:{id:'message',status:'sent',provider_message_id:'provider',conversation_id:'conversation',connection_id:'connection'}});
  expect(m.record).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({source:'api',sentBy:null,text:'Olá'}));
});
it('preserves the existing agent pause and force override rules',async()=>{
  m.agent='paused';expect((await POST(req())).status).toBe(409);expect(m.sendText).not.toHaveBeenCalled();
  expect((await POST(req({force:true}))).status).toBe(201);
});
it('preserves approved-template component payloads and failure responses',async()=>{
  const components=[{type:'body',parameters:[{type:'text',text:'Maria'}]}];
  expect((await POST(req({template:{name:'welcome',components}}))).status).toBe(201);
  expect(m.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({components,name:'welcome'}));
  m.sendText.mockResolvedValue({ok:false,error:'failed'});expect((await POST(req())).status).toBe(502);
});
it('rejects invalid/authentication requests before dispatch',async()=>{
  expect((await POST(req({text:'a'.repeat(4097)}))).status).toBe(400);
  m.auth=false;expect((await POST(req())).status).toBe(401);expect(m.sendText).not.toHaveBeenCalled();
});
