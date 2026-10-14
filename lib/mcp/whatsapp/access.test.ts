import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { memoryDb } from '@/test/helpers/mcpMemoryDb';
import { resolveMcpOwner, requireDestination, type WhatsAppContext } from './access';
import { listConnections, listMessages, searchConversations } from './queries';
import { createJournal } from './journal';
import { completeUpload, resolveAttachment } from './uploads';

const m = vi.hoisted(() => ({ rules: null as any, groupEnabled: true, ownerAllowed: true }));
vi.mock('@/lib/permissions/server', () => ({
  getVisibilityRules: async () => m.rules,
  connectionAllowed: (rules: any,id: string) => !rules?.whatsapp.connection_ids || rules.whatsapp.connection_ids.includes(id),
  filterConversationsByOwner: async (_a: unknown,_o: unknown,_r: unknown,_u: unknown,rows: unknown[]) => m.ownerAllowed ? rows : [],
}));
vi.mock('@/lib/whatsapp/service', () => ({
  getWaGroupsEnabled: async () => m.groupEnabled,
  getConnectionByIdForOrg: async (db: SupabaseClient,org: string,id: string) => (await db.from('wa_connections').select('*').eq('organization_id',org).eq('id',id).maybeSingle()).data,
}));
const make = () => {
  const db = memoryDb({
    api_keys: [{ id:'key',organization_id:'org',created_by:'actor' }],
    profiles: [{ id:'actor',organization_id:'org',role:'sales' }], user_organizations: [], organizations:[{id:'org',is_active:true}],
    wa_connections: [
      {id:'number-a',organization_id:'org',phone_number:'+551100000001',provider:'evolution',status:'connected',instance_token:'SECRET'},
      {id:'number-b',organization_id:'org',phone_number:'+551100000002',provider:'meta_cloud',status:'connected',meta_app_secret:'SECRET'},
      {id:'number-x',organization_id:'foreign',phone_number:'+551100000003',provider:'evolution'},
    ],
    wa_conversations: [
      {id:'a',organization_id:'org',connection_id:'number-a',wa_name:'Grupo repetido',is_group:true,label_ids:['ok']},
      {id:'b',organization_id:'org',connection_id:'number-b',wa_name:'Grupo repetido',is_group:true,label_ids:[]},
      {id:'x',organization_id:'foreign',connection_id:'number-x',wa_name:'Grupo repetido',is_group:true},
    ],
    wa_messages:[{id:'message-a',organization_id:'org',conversation_id:'a',body:'Olá',status:'read',created_at:'2026-10-01'},{id:'message-x',organization_id:'foreign',conversation_id:'x',body:'private'}],
  });
  const account = vi.fn(async () => ({data:{user:{id:'actor',banned_until:null as string|null}},error:null}));
  const admin = { ...db, auth:{ admin:{getUserById:account} } } as unknown as SupabaseClient;
  return { db, account, admin, ctx: {admin,apiKeyId:'key',user:{id:'actor',organizationId:'org',role:'sales'}} as WhatsAppContext };
};
beforeEach(() => {m.rules=null;m.ownerAllowed=true;m.groupEnabled=true;});
it('derives owner from scoped key and membership, rejects banned/deleted/foreign owners', async () => {
  const {db,admin,account}=make();
  expect(await resolveMcpOwner(admin,'key','org')).toMatchObject({id:'actor',organizationId:'org',role:'sales'});
  expect(await resolveMcpOwner(admin,'key','foreign')).toBeNull();
  db.tables.profiles[0].organization_id='foreign';
  expect(await resolveMcpOwner(admin,'key','org')).toBeNull();
  db.tables.user_organizations.push({user_id:'actor',organization_id:'org',role:'manager'});
  expect(await resolveMcpOwner(admin,'key','org')).toMatchObject({role:'manager'});
  account.mockResolvedValueOnce({data:{user:{id:'actor',banned_until:'2999-01-01'}},error:null});
  expect(await resolveMcpOwner(admin,'key','org')).toBeNull();
  db.tables.profiles=[];
  expect(await resolveMcpOwner(admin,'key','org')).toBeNull();
});
it('disambiguates duplicate group names by stable IDs and numbers without exposing credentials', async () => {
  const {ctx}=make();
  const result=await searchConversations(ctx,{name:'repetido',groupsOnly:true,limit:30});
  expect(result.conversations.map(c=>[c.id,c.connection?.phone_number])).toEqual([['a','+551100000001'],['b','+551100000002']]);
  expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(JSON.stringify(await listConnections(ctx))).not.toContain('number-x');
});
it('enforces connection, label and owner visibility and continues filtered pagination', async () => {
  const {ctx}=make();
  m.rules={whatsapp:{connection_ids:['number-a'],label_ids:['ok']}};
  expect((await searchConversations(ctx,{limit:30})).conversations.map(c=>c.id)).toEqual(['a']);
  m.rules.whatsapp.label_ids=['missing'];
  const empty=await searchConversations(ctx,{limit:1});
  expect(empty.conversations).toEqual([]);expect(empty.nextCursor).toBe('a');
  m.rules=null;m.ownerAllowed=false;
  expect((await searchConversations(ctx,{limit:30})).conversations).toEqual([]);
});
it('refuses wrong org or mismatched number for messages and sends; honors groups switch', async () => {
  const {ctx}=make();
  await expect(requireDestination(ctx,'x','number-x')).rejects.toThrow('indisponível');
  await expect(listMessages(ctx,{conversationId:'a',connectionId:'number-b',limit:10})).rejects.toThrow('indisponível');
  expect((await listMessages(ctx,{conversationId:'a',connectionId:'number-a',limit:10})).messages[0]).toMatchObject({id:'message-a',status:'read'});
  m.rules={whatsapp:{connection_ids:['number-b']}};
  await expect(requireDestination(ctx,'a','number-a')).rejects.toThrow('indisponível');
  m.rules=null;m.groupEnabled=false;
  await expect(requireDestination(ctx,'a','number-a')).rejects.toThrow('indisponível');
  expect((await searchConversations(ctx,{groupsOnly:true,limit:10})).conversations).toEqual([]);
});
it('does not reveal operations or upload capabilities owned by another key, actor or organization', async () => {
  const {ctx,db}=make();
  db.tables.mcp_wa_operations=[{organization_id:'foreign',api_key_id:'key',operation_id:'operation',actor_id:'actor'}];
  const journal=createJournal(ctx);
  await expect(journal.load('operation')).rejects.toThrow('indisponível');
  db.tables.mcp_wa_operations[0].organization_id='org';db.tables.mcp_wa_operations[0].api_key_id='other-key';
  await expect(journal.load('operation')).rejects.toThrow('indisponível');
  db.tables.mcp_wa_operations[0].api_key_id='key';db.tables.mcp_wa_operations[0].actor_id='other-actor';
  await expect(journal.load('operation')).rejects.toThrow('indisponível');
  db.tables.mcp_wa_uploads=[{id:'file',organization_id:'org',api_key_id:'other-key',actor_id:'actor',conversation_id:'a',connection_id:'number-a',ready:true}];
  await expect(completeUpload(ctx,'file')).rejects.toThrow('indisponível');
  db.tables.mcp_wa_uploads[0].api_key_id='key';
  await expect(resolveAttachment(ctx,'file','b','number-b')).rejects.toThrow('indisponível');
  db.tables.mcp_wa_uploads[0].ready=false;db.tables.mcp_wa_uploads[0].expires_at='2020-01-01';
  await expect(completeUpload(ctx,'file')).rejects.toThrow('novo upload');
});
