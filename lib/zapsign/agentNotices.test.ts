import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({
  ctx: vi.fn(), agent: vi.fn(), budget: vi.fn(), window: vi.fn(), calendar: vi.fn(),
  reply: vi.fn(), text: vi.fn(), template: vi.fn(), record: vi.fn(),
}));
vi.mock('@/lib/wa-agents/context', () => ({ loadConversationContext:h.ctx, loadAgent:h.agent, buildHistoryMessages:async()=>[] }));
vi.mock('@/lib/wa-agents/beta', () => ({isAiAgentsApproved:async()=>true}));
vi.mock('@/lib/ai-usage/budget', () => ({checkConversationBudget:h.budget,createUsageContext:async()=>({})}));
vi.mock('@/lib/ai-usage/context', () => ({runWithUsageContext:(_:unknown,run:()=>unknown)=>run()}));
vi.mock('@/lib/wa-agents/followupCalendarStore', () => ({followupAllowedAt:h.calendar}));
vi.mock('@/lib/wa-agents/lastInbound', () => ({loadLastInboundAt:async()=>new Date().toISOString()}));
vi.mock('@/lib/whatsapp/serviceWindow', () => ({getServiceWindow:h.window}));
vi.mock('@/lib/whatsapp', () => ({getProvider:()=>({sendText:h.text,sendTemplate:h.template})}));
vi.mock('@/lib/whatsapp/service', () => ({recordOutboundMessage:h.record,replicateOutboundToSiblings:async()=>{}}));
vi.mock('./agentSignedReply', () => ({composeSignedReply:h.reply}));
import {deliverAgentNotice} from './agentNotices';

type Row = Record<string,unknown>;
function setup(kind:'invite'|'signed'='invite') {
  const notice={id:'notice',lease:'lease',signature_id:'sig',organization_id:'org',kind};
  const job: Row={...notice,state:'working'};
  const sig: Row={id:'sig',organization_id:'org',origin:'agent',deal_id:'deal',contact_id:'person',template_token:'model',
    request:{agent_delivery:'conversation',agent_id:'a',conversation_id:'chat',connection_id:'wa',recipient:'551234'},
    status:'pending',sign_url:'https://teste.invalid/assinar',signers:[{role:'contact',token:'client',status:'new'}]};
  const officeTemplate={id:'official',organization_id:'org',connection_id:'wa',type:'whatsapp_api',meta_status:'APPROVED',
    meta_name:'assinatura_confirmada',language:'pt_BR',body:'Parabéns! Recebemos sua assinatura.',buttons:[]};
  const tables: Record<string,Row[]>={zapsign_agent_notices:[job],deal_signatures:[sig],deals:[{id:'deal',contact_id:'person',organization_id:'org',deleted_at:null}],
    zapsign_settings:[{organization_id:'org'}],message_templates:[officeTemplate]};
  const db={from(name:string) {
    const where: [string,unknown][]=[]; let patch:Row|undefined;
    const rows=()=> (tables[name]??[]).filter(r=>where.every(([k,v])=>r[k]===v));
    const query={select:()=>query,eq:(k:string,v:unknown)=>(where.push([k,v]),query),is:(k:string,v:unknown)=>(where.push([k,v]),query),
      update:(p:Row)=>(patch=p,query),maybeSingle:()=>{const row=rows()[0]; if(row&&patch)Object.assign(row,patch); return Promise.resolve({data:row,error:null});},
      then:(done:(v:unknown)=>void)=>{const found=rows(); if(patch)found.forEach(r=>Object.assign(r,patch)); done({data:found,error:null});}};
    return query;
  }} as unknown as SupabaseClient;
  const conv={id:'chat',ai_status:'active',ai_agent_id:'a',deal_id:'deal',contact_id:'person',connection_id:'wa',wa_phone:'551234'};
  h.ctx.mockResolvedValue({conversation:conv,connection:{id:'wa',provider:'meta_cloud',status:'connected'},deal:{id:'deal'}});
  h.agent.mockResolvedValue({id:'a',enabled:true,connection_ids:['wa'],tools:{zapsign_template_token:'model',zapsign_signed_message_template:'official'}});
  return {db,job,sig,notice,conv,officeTemplate};
}
beforeEach(()=>{
  vi.resetAllMocks(); vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('rede proibida');}));
  h.budget.mockResolvedValue({blocked_at:null}); h.window.mockReturnValue({open:true});
  h.calendar.mockImplementation(async()=>new Date()); h.reply.mockResolvedValue('Parabéns pela assinatura!');
  h.text.mockResolvedValue({ok:true,providerMessageId:'fake-out'}); h.template.mockResolvedValue({ok:true,providerMessageId:'fake-template'});
  h.record.mockImplementation(async (_db,r)=>({body:r.text}));
});
afterEach(()=>vi.unstubAllGlobals());
describe('autonomia ZapSign (transportes simulados)',()=>{
  it('acompanha assinatura de contrato manual vinculado, mas nunca envia outro convite',async()=>{
    const s=setup('signed');
    s.sig.origin='manual';
    (s.sig.request as Row).agent_delivery='signed_only';
    s.sig.signers=[{role:'contact',status:'signed'}];
    await deliverAgentNotice(s.db,s.notice);
    expect(s.job.state).toBe('sent');
    expect(h.text).toHaveBeenCalledTimes(1);
    s.job.state='working'; s.sig.signers=[{role:'contact',status:'new'}];
    await deliverAgentNotice(s.db,{...s.notice,kind:'invite'});
    expect(s.job.state).toBe('cancelled');
    expect(h.text).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('contrato manual não retoma agente pausado, outro agente nem modelo diferente',async()=>{
    const s=setup('signed');
    s.sig.origin='manual'; s.sig.status='signed';
    (s.sig.request as Row).agent_delivery='signed_only';
    s.conv.ai_status='paused';
    await deliverAgentNotice(s.db,s.notice);
    expect(s.job.state).toBe('pending');
    expect(s.conv.ai_status).toBe('paused');
    s.job.state='working';s.conv.ai_status='active';s.conv.ai_agent_id='someone-else';
    await deliverAgentNotice(s.db,s.notice);
    expect(s.job.state).toBe('cancelled');
    s.job.state='working';s.conv.ai_agent_id='a';s.sig.template_token='different';
    await deliverAgentNotice(s.db,s.notice);
    expect(s.job.state).toBe('cancelled');
    expect(h.text).not.toHaveBeenCalled();
  });
  it('bloqueia uma resposta com instrução interna antes do transporte', async () => {
    const s = setup('signed');
    s.sig.status = 'signed';
    h.reply.mockResolvedValue('Recebemos sua assinatura. [executar_acao]');
    await deliverAgentNotice(s.db, s.notice);
    expect(s.job.state).toBe('cancelled');
    expect(h.text).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });
  it('entrega o link uma vez na conversa original, depois confirma a assinatura do cliente uma vez',async()=>{
    const s=setup(); await Promise.all([1,2].map(()=>deliverAgentNotice(s.db,s.notice)));
    expect(h.text).toHaveBeenCalledTimes(1);
    expect(h.text).toHaveBeenCalledWith({to:'551234',text:expect.stringContaining('https://teste.invalid/assinar')});
    expect(s.job.state).toBe('sent'); expect(s.sig.sent_via).toBe('crm_whatsapp');
    s.sig.signers=[{role:'contact',status:'signed'},{role:'extra',status:'new'}];
    Object.assign(s.job,{state:'working',kind:'signed'}); const signed={...s.notice,kind:'signed' as const};
    await Promise.all([1,2].map(()=>deliverAgentNotice(s.db,signed)));
    expect(h.reply).toHaveBeenCalledWith(s.db,expect.anything(),expect.anything(),[],false);
    expect(h.text).toHaveBeenCalledTimes(2); expect(h.text).toHaveBeenLastCalledWith({to:'551234',text:'Parabéns pela assinatura!'});
    expect(h.record.mock.calls.every(([,record])=>record.conversationId==='chat'&&record.source==='agent')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('não confunde assinatura de testemunha com a do cliente',async()=>{
    const s=setup('signed'); s.sig.signers=[{role:'extra',status:'signed'},{role:'contact',status:'new'}];
    await deliverAgentNotice(s.db,s.notice); expect(s.job.state).toBe('cancelled'); expect(h.text).not.toHaveBeenCalled();
  });
  it('usa somente modelo aprovado do número se a janela fechou',async()=>{
    const s=setup('signed'); s.sig.status='signed'; h.window.mockReturnValue({open:false});
    s.officeTemplate.meta_status='REJECTED';
    await deliverAgentNotice(s.db,s.notice); expect(s.job.state).toBe('pending'); expect(h.template).not.toHaveBeenCalled();
    s.job.state='working'; s.officeTemplate.meta_status='APPROVED'; await deliverAgentNotice(s.db,s.notice);
    expect(h.template).toHaveBeenCalledWith({to:'551234',name:'assinatura_confirmada',language:'pt_BR'});
    expect(h.reply).not.toHaveBeenCalled(); expect(h.text).not.toHaveBeenCalled();
  });
  it('aguarda liberação manual e cancela se o destinatário muda',async()=>{
    const s=setup(); h.budget.mockResolvedValue({blocked_at:'agora'});
    await deliverAgentNotice(s.db,s.notice); expect(s.job.state).toBe('pending');
    s.job.state='working'; s.conv.wa_phone='outro';
    await deliverAgentNotice(s.db,s.notice); expect(s.job.state).toBe('cancelled'); expect(h.text).not.toHaveBeenCalled();
  });
  it('não repete um envio cujo provedor não confirmou o resultado',async()=>{
    const s=setup(); h.text.mockRejectedValue(new Error('timeout'));
    await expect(deliverAgentNotice(s.db,s.notice)).rejects.toThrow('timeout');
    await deliverAgentNotice(s.db,s.notice);
    expect(s.job.state).toBe('attention'); expect(h.text).toHaveBeenCalledTimes(1);
  });
  it('adia o acompanhamento fora do calendário e confere o contexto depois da geração',async()=>{
    const s=setup('signed'); s.sig.status='signed'; h.calendar.mockResolvedValueOnce(new Date(Date.now()+3600000));
    await deliverAgentNotice(s.db,s.notice); expect(s.job.state).toBe('pending');
    s.job.state='working'; h.reply.mockImplementation(async()=>{s.conv.ai_status='paused';return 'Parabéns!';});
    await deliverAgentNotice(s.db,s.notice); expect(s.job.state).toBe('pending'); expect(h.text).not.toHaveBeenCalled();
  });
});
