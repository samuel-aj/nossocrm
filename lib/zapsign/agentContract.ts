import type { SupabaseClient } from '@supabase/supabase-js';
import { isDeepStrictEqual } from 'node:util';
import { AgentToolsSchema } from '@/lib/wa-agents/types';
import { checkConversationBudget } from '@/lib/ai-usage/budget';
import { loadCustomFieldDefs } from '@/lib/wa-agents/leadOps';
import { readContractTemplate } from './templateFile';
import { createTemplatePackage, isDefinitiveCreateError, officeTemplates, PackageError } from './templatePackage';
import { agentContactToken, clientFor, loadLeadSnapshot, loadZapSignSettings, reconcileWaitingAgentPackage, recordEvent, toStoredSigner, type SignatureRow } from './signatures';
import { contractReview, prepareAgentDraft, MAX_REVIEW_REQUESTS, REVIEW_HINT, type AgentContractInput, type ContractTurn } from './agentDraft';
import { splitPhone } from './variables';
import { ZapSignError, type ZapSignDoc } from './client';

type Scope = { org: string; agent: string; conversation: string; deal: string; template: string; inboundId: string; since: string };
type ResultRow = Pick<SignatureRow, 'id' | 'status' | 'doc_token' | 'sign_url' | 'origin' | 'contact_id' | 'request' |
  'sent_at' | 'created_at' | 'confirmation_timed_out_at' | 'confirmation_delivery_suppressed' | 'agent_client_signed_at'>;
const columns = 'id,status,doc_token,sign_url,origin,contact_id,request,sent_at,created_at,confirmation_timed_out_at,confirmation_delivery_suppressed,agent_client_signed_at';
const REVIEW_LOOP = `O cliente recebeu esta ficha ${MAX_REVIEW_REQUESTS} vezes e não confirmou. Não envie a ficha de novo nem peça que ele copie o texto. Chame a equipe para concluir o contrato na aba Contrato.`;

function confirmationDeadline(createdAt: string) {
  return Date.parse(createdAt) + 5 * 60_000;
}

function awaitingConfirmation(createdAt: string) {
  return { ok: true, aguardando_confirmacao_zapsign: true, estado: 'aguardando confirmação da ZapSign',
    limite_confirmacao_em: new Date(confirmationDeadline(createdAt)).toISOString() };
}

function existing(r: ResultRow, session: Scope & { phone: string; connection: string; stateAt: string | null }, currentAttempt = false) {
  const managed = r.origin === 'agent' && r.request?.agent_delivery === 'conversation' &&
    r.request.conversation_id === session.conversation && r.request.agent_id === session.agent &&
    r.request.connection_id === session.connection && r.request.recipient === session.phone &&
    (!r.request.await_provider_confirmation || r.request.confirmation_agent_state_at === session.stateAt);
  if (currentAttempt && r.confirmation_timed_out_at) {
    // The deadline worker owns the manual handoff. Discard a response from the old turn.
    return { ok: true, aguardando_confirmacao_zapsign: true, prazo_confirmacao_encerrado: true, estado: 'encaminhado para conferência humana' };
  }
  if (r.confirmation_delivery_suppressed || r.confirmation_timed_out_at || (!managed && r.request?.await_provider_confirmation)) {
    return { ok:true, existente:true, entrega_sob_responsabilidade_da_equipe:true, ...(currentAttempt && {aguardando_confirmacao_zapsign:true}),
      estado:'entrega do contrato sob responsabilidade da equipe' };
  }
  const signed = r.status === 'signed' || !!r.agent_client_signed_at;
  if (managed && r.request?.await_provider_confirmation && !r.confirmation_timed_out_at &&
      (r.status === 'processing' || (r.status === 'pending' && !r.sign_url && !signed))) {
    return awaitingConfirmation(r.created_at);
  }
  if (r.doc_token && ['signed', 'pending'].includes(r.status)) return { ok: true, existente: true,
    ...(managed && !signed && !r.sent_at && r.sign_url && !r.confirmation_timed_out_at ? { aguarda_assinatura_no_atendimento: true } : {}),
    estado: signed ? 'assinado' : 'aguardando assinatura', id_documento: r.doc_token };
  return { ok: false, erro: r.status === 'review' ? 'Este contrato já aguarda conferência humana na aba Contrato.' :
    'Já há uma tentativa deste modelo para o lead. Confira a aba Contrato e a ZapSign antes de qualquer nova criação.' };
}

export async function runAgentContract(admin: SupabaseClient, scope: Scope, input: AgentContractInput, rememberReview?: (key: string) => void) {
  const { org, agent, conversation, deal, template } = scope;
  if (!deal || !scope.inboundId) throw new Error('A criação precisa de uma conversa recebida e vinculada a um lead.');
  async function checkBinding() {
    const [conv, config, budget] = await Promise.all([
      admin.from('wa_conversations').select('deal_id, contact_id, connection_id, wa_phone, ai_state, ai_status_changed_at').eq('organization_id', org).eq('id', conversation)
        .eq('ai_status', 'active').eq('is_group', false).eq('ai_agent_id', agent).eq('deal_id', deal).maybeSingle(),
      admin.from('wa_ai_agents').select('tools').eq('organization_id', org).eq('id', agent).eq('enabled', true).maybeSingle(),
      checkConversationBudget(admin, org, conversation),
    ]);
    const tools = AgentToolsSchema.safeParse(config.data?.tools);
    if (conv.error || config.error || !conv.data?.contact_id || !conv.data.connection_id || !conv.data.wa_phone || !tools.success || tools.data.zapsign_template_token !== template || budget.blocked_at)
      throw new Error('A conversa, o agente, o limite ou o modelo não permitem criar este contrato.');
    return { contact: conv.data.contact_id as string, connection: conv.data.connection_id as string,
      phone: conv.data.wa_phone as string, mapping: tools.data.zapsign_variables ?? {},
      stateAt: (conv.data.ai_status_changed_at ?? null) as string | null,
      reviewKey: conv.data.ai_state?.zapsign_review as string | undefined };
  }
  const binding = await checkBinding();
  const session = { ...scope, ...binding };
  const { contact, mapping } = binding;
  const settings = await loadZapSignSettings(admin, org);
  if (!settings) throw new Error('ZapSign desconectada neste escritório.');
  const findExisting = async () => {
    const { data, error } = await admin.from('deal_signatures').select(columns).eq('organization_id', org)
      .eq('deal_id', deal).eq('template_token', template).or('origin.eq.agent,status.in.(processing,queued,review,pending,signed)')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error('Não foi possível conferir os contratos deste lead.');
    if (data && data.contact_id !== contact) throw new Error('O contrato anterior pertence a outro contato. Solicite conferência da equipe.');
    return data as ResultRow | null;
  };
  const prior = await findExisting();
  if (prior) return existing(prior, session);
  const client = clientFor(settings);
  const [models, snap, defs] = await Promise.all([
    client.listTemplates().catch(() => { throw new Error('Não foi possível consultar os modelos na conta ZapSign do escritório.'); }),
    loadLeadSnapshot(admin, org, deal), loadCustomFieldDefs(admin, org),
  ]);
  const tpl = officeTemplates(models).find(t => t.token === template);
  if (!tpl || !snap || snap.deal.deleted_at || snap.deal.is_lost || snap.contact.id !== contact)
    throw new Error('Verifique o modelo ativo na conta ZapSign e o contato vinculado ao lead.');
  const file = await readContractTemplate(client, tpl).catch(error => {
    if (error instanceof ZapSignError && error.status === 422) throw error;
    throw new Error('Não foi possível ler os campos do modelo DOCX do escritório.');
  });
  if (file.planNotice) throw new Error(file.planNotice);
  const history = async () => {
    const { data, error } = await admin.from('wa_messages').select('id,direction,source,status,body,transcription,created_at')
      .eq('organization_id', org).eq('conversation_id', conversation).gte('created_at', scope.since)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
    // The agent takes about a minute to answer, so the end of its previous reply is often
    // stored after this message arrived. The client answered what came before it: those
    // lines are left out. A newer message from the client or the team still stops the run.
    const at = data?.findIndex(m => m.id === scope.inboundId) ?? -1;
    if (error || !data || at < 0 || data.slice(0, at).some(m => m.direction !== 'out' || m.source !== 'agent'))
      throw new Error('O atendimento mudou. Reavalie a mensagem mais recente.');
    return data.slice(at).reverse().map((m): ContractTurn => ({
      id: m.id, direction: m.direction, agent: m.source === 'agent', text: m.transcription || m.body || '',
      ok: m.direction === 'in' || ['sent', 'delivered', 'read'].includes(m.status), at: m.created_at,
    }));
  };
  const turns = await history();
  const draft = prepareAgentDraft({ scope: [org, agent, conversation, deal, contact, template], template: { ...file, name: tpl.name },
    ctx: snap.ctx, signer: snap.contact.name, fields: defs.map(f => ({ key: f.key, label: f.label || f.key })), turns, supplied: input.dados, mapping });
  if (draft.missing.length || draft.office.length)
    return { ok: false, perguntar_ao_cliente: draft.missing, preencher_no_crm: draft.office };
  const review = contractReview(turns, draft, binding.reviewKey);
  if (!review.confirmed) {
    // The client already received this same ficha three times: a person takes over instead of a fourth copy.
    if (review.repeated >= MAX_REVIEW_REQUESTS) return { ok: false, erro: REVIEW_LOOP };
    if (review.key) rememberReview?.(review.key);
    return { ok: true, criado: false, solicitar_confirmacao: review.question, como_perguntar: REVIEW_HINT };
  }
  if (input.modo === 'preparar') return { ok: true, criado: false, ficha_confirmada: true, proximo_passo: 'criar' };
  const [freshBinding, latest, freshSettings, freshSnap] = await Promise.all([
    checkBinding(), history(), loadZapSignSettings(admin, org), loadLeadSnapshot(admin, org, deal),
  ]);
  if (!isDeepStrictEqual(freshBinding, binding) || !contractReview(latest, draft, freshBinding.reviewKey).confirmed ||
      !freshSettings || freshSettings.sandbox !== settings.sandbox || freshSettings.api_token !== settings.api_token ||
      !isDeepStrictEqual(freshSnap, snap))
    throw new Error('Os dados do atendimento mudaram. Prepare o contrato novamente.');

  const signerIdentity = draft.identity;
  const members = tpl.extra_templates?.map(({token, name}) => ({token, name}));
  const request = { template_token: template, template_name: tpl.name, variables: {}, signer: { send: 'link' },
    agent_id: agent, conversation_id: conversation, connection_id: binding.connection, recipient: binding.phone,
    agent_delivery: 'conversation', agent_signer: signerIdentity, confirmation_message_id: scope.inboundId, values: draft.data,
    await_provider_confirmation: true, confirmation_agent_state_at: binding.stateAt,
    ...(members?.length ? { package_expected: members.length, package_members: members } : {}) };
  const { data: row, error } = await admin.from('deal_signatures').insert({
    organization_id: org, deal_id: deal, contact_id: contact, stage_id: snap.deal.stage_id, origin: 'agent',
    status: 'processing', lock_until: null, attempts: 1, template_token: template, template_name: tpl.name,
    request,
  }).select('id,created_at').single();
  if (error?.code === '23505') {
    const other = await findExisting(); if (other) return existing(other, session);
  }
  if (error || !row) throw new Error('Não foi possível reservar a criação. Nenhum pedido enviado.');
  const readReservation = async () => {
    const result = await admin.from('deal_signatures').select(columns).eq('organization_id', org).eq('id', row.id)
      .eq('deal_id', deal).eq('contact_id', contact).maybeSingle();
    return result.data as ResultRow | null;
  };
  const phone = splitPhone(signerIdentity.phone);
  const name = (tpl.name + ' - ' + draft.signer).slice(0, 255);
  let doc: ZapSignDoc;
  try {
    doc = await createTemplatePackage(client, tpl, { template_id: template, name, signer_name: draft.signer,
      ...(signerIdentity.email ? { signer_email: signerIdentity.email } : {}), signer_phone_country: phone.country || undefined,
      signer_phone_number: phone.number || undefined, data: draft.data, lang: 'pt-br', external_id: row.id,
      send_automatic_email: false, send_automatic_whatsapp: false, signer_has_incomplete_fields: false }, undefined, confirmationDeadline(row.created_at));
    if (!doc?.token) throw new Error('Sem identificador do provedor.');
  } catch (error) {
    const incompletePackage = error instanceof PackageError ? error : null;
    const wait = incompletePackage ? incompletePackage.awaitConfirmation : !isDefinitiveCreateError(error);
    const failure = incompletePackage?.message ?? (error instanceof ZapSignError && error.status === 402
      ? 'Confira o plano da API ZapSign do escritório.' : 'A ZapSign recusou o pedido. Solicite conferência da equipe antes de nova tentativa.');
    // A failed HTTP exchange is not proof that no document exists. A verified
    // webhook, or the deadline worker, may have already settled this exact row.
    const evidence = incompletePackage ? {
      ...(incompletePackage.docToken && { doc_token: incompletePackage.docToken }),
      request: { ...request, package_unverified: true, package_attachment_models: incompletePackage.attachmentModels },
    } : null;
    const update = await admin.from('deal_signatures').update({
      ...(!wait && { status: 'failed' }), ...evidence,
      last_error: wait ? 'Aguardando confirmação da criação pela ZapSign.' : failure,
    }).eq('organization_id', org).eq('id', row.id).eq('status', 'processing').select(columns).maybeSingle();
    const reservation = (update.data as ResultRow | null) ?? await readReservation();
    if (!update.data && evidence && reservation?.status === 'failed' && reservation.confirmation_timed_out_at &&
        (!reservation.doc_token || reservation.doc_token === incompletePackage?.docToken)) {
      // The deadline owns the handoff, but the late provider receipts still belong
      // to this envelope. Preserve them without clearing the timeout or its reason.
      const late = admin.from('deal_signatures').update(evidence).eq('organization_id', org).eq('id', row.id)
        .eq('status', 'failed').eq('confirmation_timed_out_at', reservation.confirmation_timed_out_at);
      await (reservation.doc_token ? late.eq('doc_token', reservation.doc_token) : late.is('doc_token', null));
    }
    if (wait && incompletePackage) {
      const verified = await reconcileWaitingAgentPackage(admin, org, row.id).catch(() => null);
      if (verified) return existing(verified, session, true);
    }
    if (reservation && (!['processing','failed'].includes(reservation.status) || reservation.confirmation_timed_out_at)) {
      return existing(reservation, session, true);
    }
    if (!wait) throw new Error(failure);
    return awaitingConfirmation(row.created_at);
  }
  const clientToken = agentContactToken(doc.signers ?? [],signerIdentity);
  const signers = (doc.signers ?? []).map(s => toStoredSigner(s, s.token === clientToken ? 'contact' : 'extra'));
  const contactSigner = signers.find(s=>s.role==='contact');
  const signUrl = contactSigner?.sign_url ?? null;
  const confirmed = {
    doc_token: doc.token, doc_name: name, status: 'pending', sign_url: signUrl, signers, sent_via: 'link',
    last_error:signUrl ? null : 'Aguardando identificação do signatário do lead na ZapSign.', updated_at: new Date().toISOString(),
  };
  const { data: saved, error: saveError } = await admin.from('deal_signatures').update(confirmed)
    .eq('organization_id', org).eq('id', row.id).eq('status', 'processing').select(columns).maybeSingle();
  if (saveError) {
    const known = await readReservation();
    return known ? existing(known, session, true) : awaitingConfirmation(row.created_at);
  }
  if (!saved) {
    const known = await readReservation();
    if (known?.confirmation_timed_out_at) {
      // Keep late proof for the team. The timeout marker prevents an automatic invitation.
      if (known.status === 'failed' && (!known.doc_token || known.doc_token === doc.token)) {
        const late = admin.from('deal_signatures').update(confirmed).eq('organization_id', org).eq('id', row.id)
          .eq('status', 'failed').eq('confirmation_timed_out_at', known.confirmation_timed_out_at);
        await (known.doc_token ? late.eq('doc_token', doc.token) : late.is('doc_token', null));
      }
      return existing(known, session, true);
    }
    // The webhook may have claimed the token before our response. Fill a missing link
    // without changing its (possibly already signed) status or newer signer records.
    if (contactSigner && known?.doc_token === doc.token && !known.sign_url) {
      const bound = await admin.rpc('bind_agent_contract_signer',{p_org:org,p_id:row.id,p_doc:doc.token,p_signer:contactSigner});
      if (!bound.error) {
        const other = await readReservation();
        if (other) return existing(other, session, true);
      }
    }
    return known ? existing(known, session, true) : awaitingConfirmation(row.created_at);
  }
  await recordEvent(admin, { id: row.id, organization_id: org, deal_id: deal, doc_name: name, doc_token: doc.token }, 'created', { origin: 'agent', agent_id: agent });
  if (saved.confirmation_timed_out_at || saved.confirmation_delivery_suppressed || !signUrl) return existing(saved as ResultRow, session, true);
  return { ok: true, criado: true, id_documento: doc.token, estado: 'aguardando assinatura', envio_do_link: 'programado na conversa' };
}
