import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadPdf } from '@/scripts/mcp-upload-pdf.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { memoryDb } from '@/test/helpers/mcpMemoryDb';
import { sha256 } from '@/lib/mcp/whatsapp/uploads';

const m = vi.hoisted(() => ({ admin: null as any, user: null as any, dispatches: [] as any[], files: new Map<string,Uint8Array>() }));
vi.mock('@/lib/ai/tools', () => ({ createCRMTools: () => ({}) }));
vi.mock('@/lib/public-api/auth', () => ({ authPublicApi: async (r: Request) => r.headers.get('x-api-key') === 'local-test-key'
  ? {ok:true,organizationId:m.user.organizationId,apiKeyId:'test-key-id'} : {ok:false,status:401,body:{error:'Unauthorized'}} }));
vi.mock('@/lib/supabase/server', () => ({createStaticAdminClient: () => m.admin}));
vi.mock('@/lib/mcp/whatsapp/access', async original => ({...await original<typeof import('@/lib/mcp/whatsapp/access')>(),resolveMcpOwner:async()=>m.user}));
vi.mock('@/lib/permissions/server', () => ({getVisibilityRules:async()=>null,connectionAllowed:()=>true,filterConversationsByOwner:async(_a:unknown,_o:unknown,_r:unknown,_u:unknown,rows:unknown[])=>rows}));
vi.mock('@/lib/whatsapp/sendWindow', () => ({checkSendWindow:async()=>null}));
vi.mock('@/lib/whatsapp/service', () => ({
  getConnectionByIdForOrg: async (_a:unknown,org:string,id:string)=>m.admin.tables.wa_connections.find((c:any)=>c.id===id&&c.organization_id===org),
  getGroupConversation: async (_a:unknown,org:string,id:string)=>m.admin.tables.wa_conversations.find((c:any)=>c.id===id&&c.organization_id===org),
  getWaGroupsEnabled: async()=>true, getQuotableMessage:vi.fn(), ensureConversation:vi.fn(),
  recordOutboundMessage:async(_a:unknown,r:any)=>{
    const existing=m.admin.tables.wa_messages.find((x:any)=>x.evolution_message_id===r.providerMessageId);
    if(existing)return existing;
    const message={id:randomUUID(),organization_id:r.orgId,conversation_id:r.conversationId,body:r.text,status:r.status,evolution_message_id:r.providerMessageId,sent_by:r.sentBy,created_at:new Date().toISOString(),direction:'out'};
    m.admin.tables.wa_messages.push(message);return message;
  }, replicateOutboundToSiblings:vi.fn(),
}));
vi.mock('@/lib/whatsapp', () => ({getProvider:()=>({
  sendText:async(input:any)=>{m.dispatches.push({type:'text',...input});return{ok:true,providerMessageId:`provider-${m.dispatches.length}`};},
  sendMedia:async(input:any)=>{m.dispatches.push({type:'pdf',...input});return{ok:true,providerMessageId:`provider-${m.dispatches.length}`};},
})}));
import { GET, POST, DELETE } from './route';
const ids=Array.from({length:10},()=>randomUUID());
let server:Server, endpoint:string;
const localFetch=globalThis.fetch;
beforeAll(async()=>{
  m.user={id:ids[0],organizationId:ids[1],role:'admin'};
  const db=memoryDb({
    wa_connections:[{id:ids[2],organization_id:ids[1],provider:'evolution',phone_number:'+551100000001',status:'connected'},{id:ids[3],organization_id:ids[1],provider:'meta_cloud',phone_number:'+551100000002',status:'connected'}],
    wa_conversations:[{id:ids[4],organization_id:ids[1],connection_id:ids[2],wa_name:'Grupo de teste',wa_phone:'120000@g.us',is_group:true},{id:ids[5],organization_id:ids[1],connection_id:ids[3],wa_name:'Grupo de teste',wa_phone:'120001@g.us',is_group:true}],
    mcp_wa_operations:[],mcp_wa_items:[],mcp_wa_uploads:[],wa_messages:[],
  });
  m.admin={...db,storage:{from:()=>({
    createSignedUploadUrl:async(path:string)=>({data:{signedUrl:`https://storage.test/${path}`},error:null}),
    createSignedUrl:async(path:string)=>({data:{signedUrl:`https://storage.test/${path}`},error:null}),
    upload:async(path:string,bytes:Uint8Array)=>{m.files.set(path,bytes);return{error:null};},
  })},rpc:async(name:string,args:any)=>{
    const match=(r:any)=>r.organization_id===args.p_org&&r.api_key_id===args.p_key&&r.operation_id===args.p_operation;
    if(name==='mcp_wa_create_operation'){
      const existing=db.tables.mcp_wa_operations.find(match);
      if(existing)return{data:null,error:existing.payload_hash===args.p_hash?null:{message:'IDEMPOTENCY_CONFLICT'}};
      db.tables.mcp_wa_operations.push({organization_id:args.p_org,api_key_id:args.p_key,operation_id:args.p_operation,actor_id:args.p_actor,conversation_id:args.p_conversation,connection_id:args.p_connection,payload_hash:args.p_hash});
      args.p_items.forEach((payload:any,position:number)=>db.tables.mcp_wa_items.push({organization_id:args.p_org,api_key_id:args.p_key,operation_id:args.p_operation,item_id:payload.itemId,position,payload,state:'pending',updated_at:new Date().toISOString()}));
      return{data:null,error:null};
    }
    const item=db.tables.mcp_wa_items.filter(match).find(r=>r.state!=='completed');
    if(!item||item.state!=='pending')return{data:null,error:null};
    Object.assign(item,{state:'preparing',claim_token:args.p_token});return{data:structuredClone(item),error:null};
  }};
  globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.hostname==='storage.test'){
      const path=decodeURIComponent(url.pathname.slice(1));
      if(init?.method==='PUT'){m.files.set(path,new Uint8Array(init.body as ArrayBuffer));return new Response('{}');}
      const bytes=m.files.get(path);return new Response(bytes?new Uint8Array(bytes):null,{status:bytes?200:404});
    }
    return localFetch(input,init);
  };
  server=createServer(async(req,res)=>{
    try{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
      const request=new Request(`${endpoint}`,{method:req.method,headers:req.headers as Record<string,string>,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
      const result=req.method==='POST'?await POST(request):req.method==='DELETE'?await DELETE():await GET();
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
    }catch{res.writeHead(500);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();endpoint=`http://127.0.0.1:${typeof address==='object'&&address?address.port:0}/api/mcp`;
});
afterAll(async()=>{globalThis.fetch=localFetch;server.closeAllConnections();server.close();await once(server,'close');});

it('discovers and executes reads, PDF upload and ordered sends using the official Streamable HTTP client',async()=>{
  const client=new Client({name:'local-acceptance-test',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:'Bearer local-test-key'}}}));
  try{
    expect((await client.listTools()).tools.map(t=>t.name)).toHaveLength(8);
    const call=async(name:string,args:Record<string,unknown>)=>{
      const result=await client.callTool({name:`crm.whatsapp.${name}`,arguments:args});
      expect(result.isError).toBe(false);return result.structuredContent as any;
    };
    expect((await call('connections.list',{})).connections).toHaveLength(2);
    const found=await call('conversations.search',{name:'Grupo de teste',groupsOnly:true});
    expect(found.conversations).toHaveLength(2);
    expect(new Set(found.conversations.map((c:any)=>c.connection.phone_number)).size).toBe(2);
    const pdf=Buffer.from('%PDF-1.7\nLocal fixture\n%%EOF');
    const prepared=await call('uploads.prepare',{conversationId:ids[4],connectionId:ids[2],fileName:'Revisão.pdf',mimeType:'application/pdf',size:pdf.length,sha256:sha256(pdf)});
    await fetch(prepared.uploadUrl,{method:'PUT',body:pdf});
    expect((await call('uploads.complete',{attachmentId:prepared.attachmentId})).ready).toBe(true);
    const approved='  Olá!\n\n*Apresentação* → revisão 😊\n';
    const args={operationId:ids[6],conversationId:ids[4],connectionId:ids[2],items:[
      {itemId:randomUUID(),type:'text',text:approved},
      {itemId:randomUUID(),type:'text',text:'*Estratégia*\nAguardo sua revisão.'},
      {itemId:randomUUID(),type:'pdf',attachmentId:prepared.attachmentId},
      {itemId:randomUUID(),type:'text',text:'Roteiro completo.\nFim.'},
    ]};
    const sent=await call('sequences.send',args);
    expect(sent.completed).toBe(true);expect(sent.items).toHaveLength(4);
    expect(m.dispatches.map(x=>x.type)).toEqual(['text','text','pdf','text']);
    expect(m.dispatches[0].text).toBe(approved);expect(m.dispatches[2].fileName).toBe('Revisão.pdf');
    expect(m.admin.tables.wa_messages.every((x:any)=>x.sent_by===ids[0]&&x.conversation_id===ids[4])).toBe(true);
    await call('sequences.send',args);await call('sequences.resume',{operationId:ids[6]});
    expect(m.dispatches).toHaveLength(4);
    m.admin.tables.wa_messages[0].status='read';
    expect((await call('sequences.get',{operationId:ids[6]})).items[0].deliveryStatus).toBe('read');
    expect((await call('messages.list',{conversationId:ids[4],connectionId:ids[2]})).messages).toHaveLength(4);
    const changed=await client.callTool({name:'crm.whatsapp.sequences.send',arguments:{...args,items:[{itemId:randomUUID(),type:'text',text:'changed'}]}});
    expect(changed.isError).toBe(true);expect(m.dispatches).toHaveLength(4);
  }finally{await client.close();}
});

it('rejects unauthorized, cross-origin, invalid version and notification dispatches',async()=>{
  const send=(body:unknown,headers:Record<string,string>={})=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer local-test-key',...headers},body:JSON.stringify(body)});
  const request={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}};
  expect((await send(request,{Authorization:'Bearer wrong'})).status).toBe(401);
  expect((await send(request,{Origin:'https://evil.test'})).status).toBe(403);
  expect((await send(request,{'MCP-Protocol-Version':'1900-01-01'})).status).toBe(400);
  expect((await (await send(request)).json()).result.protocolVersion).toBe('2025-06-18');
  const before=m.dispatches.length;
  expect((await send({jsonrpc:'2.0',method:'tools/call',params:{name:'crm.whatsapp.sequences.send',arguments:{}}})).status).toBe(202);
  expect(m.dispatches).toHaveLength(before);
  expect((await fetch(endpoint)).status).toBe(405);
});

it('uploads a local PDF through the helper without forwarding the CRM credential to Storage or sending a message',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'nossocrm-mcp-local-'));
  const filePath=join(directory,'Revisão.pdf');
  await writeFile(filePath,Buffer.from('%PDF-1.7\nLocal file\n%%EOF'));
  const before=m.dispatches.length;
  const previousFetch=globalThis.fetch;
  const storageCalls:RequestInit[]=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.hostname==='storage.test')storageCalls.push(init??{});
    return previousFetch(input,init);
  };
  try{
    const uploaded=await uploadPdf({filePath,conversationId:ids[4],connectionId:ids[2],endpoint,apiKey:'local-test-key',storageOrigin:'https://storage.test'});
    expect(uploaded).toMatchObject({ready:true,fileName:'Revisão.pdf',mimeType:'application/pdf'});
    const manifest=m.admin.tables.mcp_wa_uploads.find((row:any)=>row.id===uploaded.attachmentId);
    expect(manifest.sealed_path).toMatch(/\/Revisao\.pdf$/);
    expect(m.dispatches).toHaveLength(before);
    expect(storageCalls.some(c=>c.method==='PUT')).toBe(true);
    for(const call of storageCalls)expect(new Headers(call.headers).has('authorization')).toBe(false);
  }finally{globalThis.fetch=previousFetch;await unlink(filePath);await rmdir(directory);}
});
