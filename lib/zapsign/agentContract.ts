import type { SupabaseClient } from '@supabase/supabase-js';
import { isDeepStrictEqual } from 'node:util';
import { AgentToolsSchema } from '@/lib/wa-agents/types';
import { checkConversationBudget } from '@/lib/ai-usage/budget';
import { loadCustomFieldDefs } from '@/lib/wa-agents/leadOps';
import { readContractTemplate } from './templateFile';
import { createTemplatePackage, officeTemplates, PackageError } from './templatePackage';
import { agentContactToken, clientFor, loadLeadSnapshot, loadZapSignSettings, recordEvent, toStoredSigner, type SignatureRow } from './signatures';
import { contractReview, prepareAgentDraft, type AgentContractInput, type ContractTurn } from './agentDraft';
import { splitPhone } from './variables';
import type { ZapSignDoc } from './client';

type Scope = { org: string; agent: string; conversation: string; deal: string; template: string; inboundId: string; since: string };
type ResultRow = Pick<SignatureRow, 'id' | 'status' | 'doc_token' | 'sign_url' | 'origin' | 'contact_id'>;
const columns = 'id,status,doc_token,sign_url,origin,contact_id';

function existing(r: ResultRow) {
  if (r.doc_token && ['signed', 'pending'].includes(r.status)) return { ok: true, existente: true, estado: r.status === 'signed' ? 'assinado' : 'aguardando assinatura', id_documento: r.doc_token };
  return { ok: false, erro: r.status === 'review' ? 'Este contrato já aguarda conferência humana na aba Contrato.' :
    'Já há uma tentativa deste modelo para o lead. Confira a aba Contrato e a ZapSign antes de qualquer nova criação.' };
}

export async function runAgentContract(admin: SupabaseClient, scope: Scope, input: AgentContractInput, rememberReview?: (key: string) => void) {
  const { org, agent, conversation, deal, template } = scope;
  if (!deal || !scope.inboundId) throw new Error('A criação precisa de uma conversa recebida e vinculada a um lead.');
  async function checkBinding() {
    const [conv, config, budget] = await Promise.all([
      admin.from('wa_conversations').select('deal_id, contact_id, connection_id, wa_phone, ai_state').eq('organization_id', org).eq('id', conversation)
        .eq('ai_status', 'active').eq('is_group', false).eq('ai_agent_id', agent).eq('deal_id', deal).maybeSingle(),
      admin.from('wa_ai_agents').select('tools').eq('organization_id', org).eq('id', agent).eq('enabled', true).maybeSingle(),
      checkConversationBudget(admin, org, conversation),
    ]);
    const tools = AgentToolsSchema.safeParse(config.data?.tools);
    if (conv.error || config.error || !conv.data?.contact_id || !conv.data.connection_id || !conv.data.wa_phone || !tools.success || tools.data.zapsign_template_token !== template || budget.blocked_at)
      throw new Error('A conversa, o agente, o limite ou o modelo não permitem criar este contrato.');
    return { contact: conv.data.contact_id as string, connection: conv.data.connection_id as string,
      phone: conv.data.wa_phone as string, mapping: tools.data.zapsign_variables ?? {},
      reviewKey: conv.data.ai_state?.zapsign_review as string | undefined };
  }
  const binding = await checkBinding();
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
  if (prior) return existing(prior);
  const client = clientFor(settings);
  const [models, snap, defs] = await Promise.all([
    client.listTemplates().catch(() => { throw new Error('Não foi possível consultar os modelos na conta ZapSign do escritório.'); }),
    loadLeadSnapshot(admin, org, deal), loadCustomFieldDefs(admin, org),
  ]);
  const tpl = officeTemplates(models).find(t => t.token === template);
  if (!tpl || !snap || snap.deal.deleted_at || snap.deal.is_lost || snap.contact.id !== contact)
    throw new Error('Verifique o modelo ativo na conta ZapSign e o contato vinculado ao lead.');
  const file = await readContractTemplate(client, tpl).catch(() => { throw new Error('Não foi possível ler os campos do modelo DOCX do escritório.'); });
  if (file.planNotice) throw new Error(file.planNotice);
  const history = async () => {
    const { data, error } = await admin.from('wa_messages').select('id,direction,source,status,body,transcription,created_at')
      .eq('organization_id', org).eq('conversation_id', conversation).gte('created_at', scope.since)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
    if (error || data?.[0]?.id !== scope.inboundId) throw new Error('O atendimento mudou. Reavalie a mensagem mais recente.');
    return data.slice().reverse().map((m): ContractTurn => ({
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
    if (review.key) rememberReview?.(review.key);
    return { ok: true, criado: false, solicitar_confirmacao: review.question };
  }
  if (input.modo === 'preparar') return { ok: true, criado: false, ficha_confirmada: true, proximo_passo: 'criar' };
  const [freshBinding, latest, freshSettings, freshSnap] = await Promise.all([
    checkBinding(), history(), loadZapSignSettings(admin, org), loadLeadSnapshot(admin, org, deal),
  ]);
  if (!isDeepStrictEqual(freshBinding, binding) || !contractReview(latest, draft, freshBinding.reviewKey).confirmed ||
      !freshSettings || freshSettings.sandbox !== settings.sandbox || freshSettings.api_token !== settings.api_token ||
      !isDeepStrictEqual(freshSnap, snap))
    throw new Error('Os dados do atendimento mudaram. Prepare o contrato novamente.');

  const signerIdentity = {name:draft.signer, email:snap.contact.email, phone:snap.contact.phone};
  const { data: row, error } = await admin.from('deal_signatures').insert({
    organization_id: org, deal_id: deal, contact_id: contact, stage_id: snap.deal.stage_id, origin: 'agent',
    status: 'processing', lock_until: null, attempts: 1, template_token: template, template_name: tpl.name,
    request: { template_token: template, template_name: tpl.name, variables: {}, signer: { send: 'link' },
      agent_id: agent, conversation_id: conversation, connection_id: binding.connection, recipient: binding.phone,
      agent_delivery: 'conversation', agent_signer:signerIdentity, confirmation_message_id: scope.inboundId, values: draft.data,
      ...(tpl.extra_templates?.length ? { package_expected: tpl.extra_templates.length } : {}) },
  }).select('id').single();
  if (error?.code === '23505') {
    const other = await findExisting(); if (other) return existing(other);
  }
  if (error || !row) throw new Error('Não foi possível reservar a criação. Nenhum pedido enviado.');
  const phone = splitPhone(snap.contact.phone);
  const name = (tpl.name + ' - ' + draft.signer).slice(0, 255);
  let doc: ZapSignDoc;
  try {
    doc = await createTemplatePackage(client, tpl, { template_id: template, name, signer_name: draft.signer,
      signer_email: snap.contact.email || undefined, signer_phone_country: phone.country || undefined,
      signer_phone_number: phone.number || undefined, data: draft.data, lang: 'pt-br', external_id: row.id,
      send_automatic_email: false, send_automatic_whatsapp: false, signer_has_incomplete_fields: false });
    if (!doc?.token) throw new Error('Sem identificador do provedor.');
  } catch (error) {
    // The provider might already have created it. Neither the agent nor the worker retries this row.
    await admin.from('deal_signatures').update({ status: 'failed', ...(error instanceof PackageError ? {doc_token:error.docToken} : {}),
      last_error: error instanceof PackageError ? error.message : 'Criação não confirmada. Conferir na ZapSign antes de nova tentativa.' })
      .eq('organization_id', org).eq('id', row.id).eq('status', 'processing');
    if (error instanceof PackageError) throw error;
    throw new Error('Criação não confirmada. Peça à equipe para conferir na ZapSign; não repita o pedido.');
  }
  const clientToken = agentContactToken(doc.signers ?? [],signerIdentity);
  const signers = (doc.signers ?? []).map(s => toStoredSigner(s, s.token === clientToken ? 'contact' : 'extra'));
  const contactSigner = signers.find(s=>s.role==='contact');
  const signUrl = contactSigner?.sign_url ?? null;
  const { data: saved, error: saveError } = await admin.from('deal_signatures').update({
    doc_token: doc.token, doc_name: name, status: 'pending', sign_url: signUrl, signers, sent_via: 'link',
    last_error:signUrl ? null : 'Aguardando identificação do signatário do lead na ZapSign.', updated_at: new Date().toISOString(),
  }).eq('organization_id', org).eq('id', row.id).eq('status', 'processing').select(columns).maybeSingle();
  if (saveError) throw new Error('Confira o registro da ZapSign. Não repita a criação.');
  if (!saved) {
    // The webhook may have claimed the token before our response. Fill a missing link
    // without changing its (possibly already signed) status or newer signer records.
    if (contactSigner) {
      const bound = await admin.rpc('bind_agent_contract_signer',{p_org:org,p_id:row.id,p_doc:doc.token,p_signer:contactSigner});
      if (bound.error) throw new Error('Confira o vínculo do signatário na aba Contrato. Não repita a criação.');
    }
    const other = await findExisting(); if (other) return existing(other);
    throw new Error('Confira a aba Contrato.');
  }
  await recordEvent(admin, { id: row.id, organization_id: org, deal_id: deal, doc_name: name, doc_token: doc.token }, 'created', { origin: 'agent', agent_id: agent });
  return { ok: true, criado: true, id_documento: doc.token, estado: 'aguardando assinatura', envio_do_link: signUrl ? 'programado na conversa' : 'aguardando link da ZapSign' };
}
