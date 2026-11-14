import type { SupabaseClient } from '@supabase/supabase-js';
import { checkConversationBudget, createUsageContext } from '@/lib/ai-usage/budget';
import { runWithUsageContext } from '@/lib/ai-usage/context';
import { getProvider } from '@/lib/whatsapp';
import { dispatchOutbound } from '@/lib/whatsapp/outbound';
import { getServiceWindow } from '@/lib/whatsapp/serviceWindow';
import { isAiAgentsApproved } from '@/lib/wa-agents/beta';
import { buildHistoryMessages, loadAgent, loadConversationContext } from '@/lib/wa-agents/context';
import { followupAllowedAt } from '@/lib/wa-agents/followupCalendarStore';
import { loadLastInboundAt } from '@/lib/wa-agents/lastInbound';
import { composeSignedReply } from './agentSignedReply';
import { internalOutputReason } from '@/lib/wa-agents/replyOutput';
import type { SignatureRow } from './signatures';
import { clientHasSigned } from './agentContractFact';

type Notice = { id: string; signature_id: string; organization_id: string; kind: 'invite' | 'signed'; lease: string };
type Wait = { state: 'pending' | 'cancelled'; reason: string; due?: Date };
const later = (reason: string, minutes = 5): Wait => ({ state: 'pending', reason, due: new Date(Date.now() + minutes * 60_000) });
const cancel = (reason: string): Wait => ({ state: 'cancelled', reason });

function updateNotice(db: SupabaseClient, n: Notice, state: string, patch: Record<string, unknown>) {
  return db.from('zapsign_agent_notices').update(patch).eq('organization_id', n.organization_id)
    .eq('id', n.id).eq('lease', n.lease).eq('state', state).select('id').maybeSingle();
}

async function eligibility(db: SupabaseClient, n: Notice) {
  const org = n.organization_id;
  const { data, error } = await db.from('deal_signatures').select('*').eq('id', n.signature_id).eq('organization_id', org).maybeSingle();
  if (error) throw error;
  const sig = data as SignatureRow | null;
  const req = sig?.request;
  const managed = sig?.origin === 'agent' && req?.agent_delivery === 'conversation';
  const manual = sig && ['manual', 'rule'].includes(sig.origin) && req?.agent_delivery === 'signed_only';
  if ((!managed && !manual) || !req?.agent_id || !req.conversation_id ||
      !req.connection_id || !req.recipient || !['signed','pending'].includes(sig.status))
    return cancel('Contrato indisponível para acompanhamento.');
  if (manual && n.kind === 'invite') return cancel('O convite deste contrato é controlado pela equipe.');
  if (n.kind === 'invite' && clientHasSigned(sig)) return cancel('O cliente já assinou.');
  if (n.kind === 'signed' && !clientHasSigned(sig)) return cancel('Falta a assinatura do cliente.');
  const [ctx, agent, approved, budget, lead, integration] = await Promise.all([
    loadConversationContext(db, org, req.conversation_id), loadAgent(db, org, req.agent_id),
    isAiAgentsApproved(db, org), checkConversationBudget(db, org, req.conversation_id),
    db.from('deals').select('id').eq('organization_id',org).eq('id',sig.deal_id).eq('contact_id',sig.contact_id).is('deleted_at',null).maybeSingle(),
    db.from('zapsign_settings').select('organization_id').eq('organization_id',org).maybeSingle(),
  ]);
  if (lead.error || integration.error) throw new Error('Não foi possível validar o lead e a integração.');
  if (!lead.data || !integration.data) return cancel('Vínculo do lead ou da ZapSign removido.');
  const conv = ctx.conversation;
  if (conv.contact_id !== sig.contact_id || conv.deal_id !== sig.deal_id || ctx.deal?.id !== sig.deal_id ||
      conv.connection_id !== req.connection_id || conv.wa_phone !== req.recipient ||
      (conv.ai_agent_id && conv.ai_agent_id !== req.agent_id))
    return cancel('O lead, o contato, o número ou o agente mudou.');
  if (!agent?.enabled || !approved || agent.tools.zapsign_template_token !== sig.template_token) return cancel('Agente ou modelo desativado.');
  if (!agent.connection_ids.includes(req.connection_id) || !ctx.connection || ctx.connection.status !== 'connected')
    return later('Aguardando o número do agente ficar conectado.');
  if (!conv.ai_agent_id || conv.ai_status !== 'active' || conv.ai_approval || budget.blocked_at) return later('Aguardando liberação do atendimento.', 15);
  if (conv.ai_lock_until && Date.parse(conv.ai_lock_until) > Date.now()) return later('O agente está respondendo ao cliente.', 0.5);
  if (n.kind === 'signed') {
    const due = await followupAllowedAt(db, org);
    if (due.getTime() > Date.now()) return { ...later('Aguardando o horário de acompanhamento.'), due };
  }
  let template: { name: string; language: string; body: string } | null = null;
  if (ctx.connection.provider === 'meta_cloud' &&
      !getServiceWindow(await loadLastInboundAt(db, org, conv.id, req.connection_id)).open) {
    const id = n.kind === 'signed' && agent.tools.zapsign_signed_message_template;
    if (!id) return later('Janela de WhatsApp fechada. Aguardando nova mensagem do cliente.', 5);
    const { data: tpl, error: templateError } = await db.from('message_templates').select('meta_name,language,body,header_type,buttons')
      .eq('organization_id',org).eq('connection_id',req.connection_id).eq('id',id)
      .eq('type','whatsapp_api').eq('meta_status','APPROVED').maybeSingle();
    if (templateError) throw templateError;
    if (!tpl?.meta_name || !tpl.body || /\{\{/.test(tpl.body) || tpl.header_type || tpl.buttons?.length)
      return later('Aguardando janela de WhatsApp ou modelo de confirmação aprovado para este número.');
    template = { name: tpl.meta_name, language: tpl.language || 'pt_BR', body: tpl.body };
  }
  if (n.kind === 'invite' && !sig.sign_url) return later('Aguardando o link de assinatura.');
  return { ctx, sig, agent, template, connection: ctx.connection };
}

type Ready = Exclude<Awaited<ReturnType<typeof eligibility>>, Wait>;
async function noticeText(db: SupabaseClient, n: Notice, ready: Ready) {
  if (ready.template) return ready.template.body;
  if (n.kind === 'invite') return 'Segue o link do seu contrato para conferir e assinar: ' + ready.sig.sign_url;
  const { ctx, agent, sig } = ready;
  const usage = await createUsageContext(db, { organizationId: n.organization_id, agentId: agent.id,
    dealId: sig.deal_id, conversationId: ctx.conversation.id, scope: 'conversation' });
  return runWithUsageContext(usage, async () => {
    const history = await buildHistoryMessages(db, ctx, agent.history_limit);
    return composeSignedReply(db, agent, ctx, history, sig.status === 'signed');
  });
}

async function defer(db: SupabaseClient, n: Notice, wait: Wait) {
  const { error } = await updateNotice(db, n, 'working', { state: wait.state, note: wait.reason,
    due_at: (wait.due ?? new Date()).toISOString() });
  if (error) throw error;
}

/** Transports are called only after a durable claim. Expired dispatches require inspection. */
export async function deliverAgentNotice(db: SupabaseClient, n: Notice) {
  let dispatching = false;
  try {
    const ready = await eligibility(db,n);
    if ('state' in ready) return await defer(db,n,ready);
    const text = await noticeText(db,n,ready);
    if (internalOutputReason(text)) return await defer(db,n,cancel('Mensagem bloqueada por conter instrução interna.'));
    const fresh = await eligibility(db,n);
    if ('state' in fresh) return await defer(db,n,fresh);
    if (JSON.stringify(fresh.template) !== JSON.stringify(ready.template) || fresh.sig.sign_url !== ready.sig.sign_url ||
        fresh.sig.status !== ready.sig.status || fresh.ctx.conversation.last_message_at !== ready.ctx.conversation.last_message_at)
      return await defer(db,n,later('A conversa ou o contrato mudou durante o preparo.', 0.5));
    const { connection, ctx, template } = fresh;
    const provider = getProvider(connection);
    const { data, error } = await updateNotice(db,n,'working',{ state:'dispatching', due_at:new Date(Date.now()+180_000).toISOString(), note:null });
    if (error) throw error;
    if (!data) return;
    dispatching = true;
    const { result } = await dispatchOutbound({ admin: db, connection,
      record: { orgId:n.organization_id, conversationId:ctx.conversation.id, text, fromPhone:connection.phone_number,
        toPhone:ctx.conversation.wa_phone, sentBy:null, source:'agent' },
      send: () => template ? provider.sendTemplate!({ to:ctx.conversation.wa_phone, name:template.name, language:template.language }) :
        provider.sendText({ to:ctx.conversation.wa_phone, text }) });
    const done = await updateNotice(db,n,'dispatching',{ state:result.ok ? 'sent' : 'attention',
      note: result.ok ? null : 'O WhatsApp não confirmou o envio. Confira a conversa.' });
    if (done.error) throw done.error;
    if (result.ok && n.kind === 'invite') {
      const ack = await db.from('deal_signatures').update({ sent_at:new Date().toISOString(), sent_via:'crm_whatsapp' })
        .eq('organization_id',n.organization_id).eq('id',n.signature_id);
      if (ack.error) throw ack.error;
    }
  } catch (error) {
    if (!dispatching) await defer(db,n,later('Aguardando nova tentativa de preparo.'));
    else await updateNotice(db,n,'dispatching',{ state:'attention',note:'Envio sem confirmação. Confira a conversa.' });
    throw error;
  }
}

export async function processAgentNotices(db: SupabaseClient, deadline: number) {
  for (let i=0; i<5 && Date.now()<deadline; i++) {
    const { data, error } = await db.rpc('claim_zapsign_agent_notice');
    if (error) throw error;
    const notice = (data as Notice[] | null)?.[0];
    if (!notice) return;
    try { await deliverAgentNotice(db,notice); }
    catch { console.error('[zapsign] Pendência ao processar notificação', notice.id); }
  }
}
