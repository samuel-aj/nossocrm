import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), allowed: vi.fn(), group: vi.fn(), conn: vi.fn(), members: vi.fn(), sendText: vi.fn(), record: vi.fn() }));
vi.mock('@/lib/whatsapp/api', () => ({ requireOrgUser: m.auth, json: (body: unknown, status=200) => Response.json(body,{status}) }));
vi.mock('@/lib/permissions/server', () => ({ connectionAllowed: () => true, getVisibilityRules: async () => null }));
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: m.allowed }));
vi.mock('@/lib/whatsapp/service', () => ({ getConnectionByOrg: m.conn, getConnectionByIdForOrg: m.conn, ensureConversation: vi.fn(), getGroupConversation: m.group, getWaGroupsEnabled: async () => true, getQuotableMessage: vi.fn(), recordOutboundMessage: m.record, replicateOutboundToSiblings: vi.fn() }));
vi.mock('@/lib/whatsapp/groups', () => ({ getGroupParticipants: m.members }));
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ sendText: m.sendText }) }));
import { POST } from './route';
const member = { id:'5511999990000@s.whatsapp.net', name:'Maria', phone:'+5511999990000', admin:false };
const request = (mentions: unknown) => new Request('https://crm.test/api/whatsapp/send', { method:'POST', headers:{'content-type':'application/json',host:'crm.test',origin:'https://crm.test'}, body:JSON.stringify({conversationId:'group',text:'Olá @Maria',mentions}) });
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ok:true,user:{id:'user',organizationId:'org'},admin:{}});m.allowed.mockResolvedValue(true);m.group.mockResolvedValue({id:'group',connection_id:'conn',group_jid:'123@g.us'});m.conn.mockResolvedValue({id:'conn',status:'connected'});m.members.mockResolvedValue({ok:true,participants:[member]});m.sendText.mockResolvedValue({ok:true,providerMessageId:'message'});m.record.mockResolvedValue({body:'Olá @Maria'}); });
describe('group send mentions', () => {
 it('revalidates membership and sends real mentions while storing readable names',async()=>{const response=await POST(request([{id:member.id,start:4,end:10}]));expect(response.status).toBe(200);expect(m.sendText).toHaveBeenCalledWith(expect.objectContaining({text:'Olá @5511999990000',mentioned:[member.id],to:'123@g.us'}));expect(m.record).toHaveBeenCalledWith({},expect.objectContaining({text:'Olá @Maria'}));});
 it('does not send when the selected person left the group',async()=>{m.members.mockResolvedValue({ok:true,participants:[]});expect((await POST(request([{id:member.id,start:4,end:10}]))).status).toBe(400);expect(m.sendText).not.toHaveBeenCalled();});
 it('does not read membership or send through an invisible conversation',async()=>{m.allowed.mockResolvedValue(false);expect((await POST(request([{id:member.id,start:4,end:10}]))).status).toBe(404);expect(m.members).not.toHaveBeenCalled();expect(m.sendText).not.toHaveBeenCalled();});
 it('rejects malformed spans before provider access',async()=>{expect((await POST(request([{id:member.id,start:-1,end:10}]))).status).toBe(400);expect(m.members).not.toHaveBeenCalled();});
});
