/**
 * Assinatura eletrônica (ZapSign) no lead: cria o documento a partir do modelo
 * com os dados do CRM, manda o link ao cliente, e trata o que a ZapSign devolve
 * (assinou, recusou, abriu). A fila (`deal_signatures` em 'queued') é
 * alimentada pelo banco quando o lead entra numa etapa com regra; o envio
 * manual grava a linha e executa na hora. Tudo idempotente: o webhook pode
 * chegar repetido. SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { getServiceWindow } from '@/lib/whatsapp/serviceWindow';
import { getConnectionByIdForOrg, type WaConnectionRow } from '@/lib/whatsapp/service';
import { normalizePhoneE164 } from '@/lib/phone';
import { fullSignerName, identityFromForm, signerEmail, signerField, signerPhone, type SignerIdentity } from './signerIdentity';
import { sendTextToConversation, startBotRun } from '@/lib/wa-agents/bots';
import { loadDealContext } from '@/lib/wa-agents/context';
import { lastInboundAt, resolveDealConversation } from '@/lib/wa-agents/dealConversation';
import { loadCustomFieldDefs } from '@/lib/wa-agents/leadOps';
import { addDealTag } from '@/lib/wa-agents/actions';
import { renderTemplate } from '@/lib/wa-agents/template';
import { ensureSignLink } from './message';
import { officeTemplates, createTemplatePackage, PackageError, remainingAttachments } from './templatePackage';
import { errorMessage } from '@/lib/wa-agents/errors';
import { ZapSignClient, ZapSignError, signerLink, type ZapSignDoc, type ZapSignSigner } from './client';
import { resolveVariables, splitPhone, type VariableContext, type VariableSource } from './variables';
import { manualAgentFollowup } from './manualAgentFollowup';

export const DEAL_FILES_BUCKET = 'deal-files';
export const MAX_ATTEMPTS = 3;

export class UnconfirmedEnvelopeError extends Error {
  constructor(readonly attempts: string[]) {
    super('A ZapSign ainda não confirmou se criou o envelope anterior. Confira em Documentos na ZapSign antes de emitir novamente.');
  }
}

export type ZapSignSettings = {
  organization_id: string;
  api_token: string;
  sandbox: boolean;
  webhook_id: string | null;
  webhook_url: string | null;
  webhook_secret: string;
  template_count: number | null;
  verified_at: string | null;
  last_error: string | null;
};

export type SendChannel = 'crm_whatsapp' | 'zapsign_whatsapp' | 'zapsign_email' | 'link';

export type SignerOptions = {
  auth_mode?: string; // assinaturaTela | tokenWhatsapp | tokenEmail | tokenSms | certificadoDigital
  require_cpf?: boolean;
  require_selfie_photo?: boolean;
  require_document_photo?: boolean;
  send?: SendChannel;
  message?: string;
  allow_refuse?: boolean;
};

export type ExtraSigner = { name: string; email?: string; phone?: string; qualification?: string };

export type SignatureActions = { stage_id?: string | null; tag?: string | null; bot_id?: string | null };

export type SignatureRule = {
  stage_id: string;
  organization_id: string;
  enabled: boolean;
  template_token: string;
  template_name: string | null;
  doc_name: string | null;
  variables: Record<string, VariableSource>;
  signer: SignerOptions;
  extra_signers: ExtraSigner[];
  on_signed: SignatureActions;
  on_refused: SignatureActions;
  version: number;
};

/** O que o envio manual escolheu na hora (fica gravado na linha). */
export type SignatureRequest = {
  confirmed_signer?: SignerIdentity;
  package_expected?: number;
  package_members?: { token: string; name: string }[];
  package_attachment_models?: Record<string,string>;
  package_unverified?: boolean;
  package_recovered?: boolean;
  agent_delivery?: 'conversation' | 'signed_only';
  agent_id?: string;
  conversation_id?: string;
  connection_id?: string;
  recipient?: string;
  agent_signer?: {name:string; email:string; phone:string};
  template_token: string;
  template_name?: string | null;
  doc_name?: string | null;
  variables: Record<string, VariableSource>;
  overrides?: Record<string, string>;
  signer: SignerOptions;
  extra_signers?: ExtraSigner[];
  on_signed?: SignatureActions;
  on_refused?: SignatureActions;
};

export type SignatureRow = {
  id: string;
  organization_id: string;
  deal_id: string;
  contact_id: string | null;
  stage_id: string | null;
  origin: 'rule' | 'manual' | 'agent';
  agent_client_signed_at?: string | null;
  requested_by: string | null;
  template_token: string | null;
  template_name: string | null;
  doc_token: string | null;
  doc_name: string | null;
  status: string;
  attempts: number;
  request: SignatureRequest | null;
  signers: StoredSigner[];
  sign_url: string | null;
  sent_via: string | null;
  sent_at: string | null;
  signed_at: string | null;
  refused_at: string | null;
  refused_reason: string | null;
  file_id: string | null;
  file_path: string | null;
  last_error: string | null;
  created_at: string;
};

export type StoredSigner = {
  token: string;
  name: string;
  email: string | null;
  phone: string | null;
  sign_url: string | null;
  status: string;
  signed_at: string | null;
  role: 'contact' | 'extra';
};

export type SendOutcome =
  | { status: 'pending'; sent_via: SendChannel; note?: string }
  | { status: 'failed'; error: string; retry: boolean }
  | { status: 'cancelled'; reason: string };

export const SIGNATURE_EVENT_KIND = 'signature';

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- configuração

export async function loadZapSignSettings(admin: SupabaseClient, orgId: string): Promise<ZapSignSettings | null> {
  const { data, error } = await admin.from('zapsign_settings').select('*').eq('organization_id', orgId).maybeSingle();
  if (error) {
    if (/zapsign_settings/.test(error.message)) return null;
    throw new Error(error.message);
  }
  return (data as ZapSignSettings | null) ?? null;
}

export function clientFor(settings: Pick<ZapSignSettings, 'api_token' | 'sandbox'>, fetchImpl?: typeof fetch): ZapSignClient {
  return new ZapSignClient({ token: settings.api_token, sandbox: settings.sandbox, fetchImpl });
}

export function newWebhookSecret(): string {
  return `zs_${randomBytes(24).toString('hex')}`;
}

export async function loadSignatureRule(admin: SupabaseClient, orgId: string, stageId: string): Promise<SignatureRule | null> {
  const { data } = await admin.from('stage_signature_rules').select('*').eq('stage_id', stageId).eq('organization_id', orgId).maybeSingle();
  return data ? normalizeRule(data as Record<string, unknown>) : null;
}

export function normalizeRule(raw: Record<string, unknown>): SignatureRule {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  return {
    stage_id: String(raw.stage_id),
    organization_id: String(raw.organization_id),
    enabled: !!raw.enabled,
    template_token: String(raw.template_token ?? ''),
    template_name: (raw.template_name as string | null) ?? null,
    doc_name: (raw.doc_name as string | null) ?? null,
    variables: Object.fromEntries(Object.entries(obj(raw.variables)).map(([k, v]) => [k, typeof v === 'string' ? v : ''])),
    signer: obj(raw.signer) as SignerOptions,
    extra_signers: Array.isArray(raw.extra_signers) ? (raw.extra_signers as ExtraSigner[]) : [],
    on_signed: obj(raw.on_signed) as SignatureActions,
    on_refused: obj(raw.on_refused) as SignatureActions,
    version: Number(raw.version ?? 1),
  };
}

// ---------------------------------------------------------------- contexto do lead

export type LeadSnapshot = {
  deal: { id: string; title: string; stage_id: string | null; contact_id: string | null; is_won: boolean; is_lost: boolean; deleted_at: string | null };
  contact: { id: string | null; name: string; email: string; phone: string; company: string };
  ctx: VariableContext;
};

/** Dados do lead e do contato já no formato das variáveis do modelo. */
export async function loadLeadSnapshot(admin: SupabaseClient, orgId: string, dealId: string): Promise<LeadSnapshot | null> {
  const { data: dealRow } = await admin
    .from('deals')
    .select('id, title, stage_id, contact_id, is_won, is_lost, deleted_at')
    .eq('organization_id', orgId)
    .eq('id', dealId)
    .maybeSingle();
  const d = dealRow as LeadSnapshot['deal'] | null;
  if (!d) return null;
  const [ctxDeal, defs, orgRow, contactRow] = await Promise.all([
    loadDealContext(admin, orgId, { dealId }),
    loadCustomFieldDefs(admin, orgId).catch(() => []),
    admin.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    d.contact_id ? admin.from('contacts').select('id, name, email, phone, company_name').eq('organization_id', orgId).eq('id', d.contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const c = (contactRow.data ?? null) as { id: string; name: string | null; email: string | null; phone: string | null; company_name: string | null } | null;
  const contact = {
    id: c?.id ?? null,
    name: (c?.name ?? '').trim(),
    email: (c?.email ?? '').trim(),
    phone: normalizePhoneE164(c?.phone ?? ''),
    company: (c?.company_name ?? '').trim(),
  };
  const ctx: VariableContext = {
    contact,
    deal: {
      title: ctxDeal?.title ?? d.title ?? '',
      value: ctxDeal?.value ?? null,
      items: (ctxDeal?.items ?? []).map((i) => ({ name: i.name, quantity: Number(i.quantity ?? 1), price: Number(i.price ?? 0) })),
      stage: ctxDeal?.stage_label ?? '',
      board: ctxDeal?.board_name ?? '',
      owner: ctxDeal?.owner_name ?? '',
      description: ctxDeal?.description ?? '',
      customFields: ctxDeal?.custom_fields ?? {},
    },
    customFieldTypes: Object.fromEntries(defs.map((f) => [f.key, f.type])),
    organizationName: ((orgRow.data as { name?: string } | null)?.name ?? '').trim(),
  };
  return { deal: { ...d, is_won: !!d.is_won, is_lost: !!d.is_lost }, contact, ctx };
}

// ---------------------------------------------------------------- envio

type SendDeps = { client?: ZapSignClient; fetchImpl?: typeof fetch };

/**
 * Cria o documento na ZapSign para UMA linha de deal_signatures (já em
 * 'processing') e manda o link. Devolve o que aconteceu; quem chama grava.
 */
export async function sendSignature(admin: SupabaseClient, row: SignatureRow, deps: SendDeps = {}): Promise<SendOutcome> {
  const orgId = row.organization_id;
  const settings = await loadZapSignSettings(admin, orgId);
  if (!settings) return { status: 'cancelled', reason: 'a ZapSign não está conectada nesta organização' };

  // o que enviar: o pedido conferido por uma pessoa (envio manual ou regra da
  // etapa confirmada na conferência) ou, sem ele, a regra da etapa como está
  let spec: SignatureRequest | null = row.request;
  const reviewed = !!row.request;
  let rule: SignatureRule | null = null;
  if (!spec && row.origin === 'rule') {
    rule = row.stage_id ? await loadSignatureRule(admin, orgId, row.stage_id) : null;
    if (!rule || !rule.enabled) return { status: 'cancelled', reason: 'a regra da etapa foi desligada' };
    spec = {
      template_token: rule.template_token,
      template_name: rule.template_name,
      doc_name: rule.doc_name,
      variables: rule.variables,
      signer: rule.signer,
      extra_signers: rule.extra_signers,
      on_signed: rule.on_signed,
      on_refused: rule.on_refused,
    };
  }
  if (!spec?.template_token) return { status: 'failed', error: 'sem modelo escolhido', retry: false };
  if (spec.package_unverified || (row.doc_token && spec.package_members?.length))
    return { status: 'failed', error: new PackageError(row.doc_token).message, retry: false };

  const snap = await loadLeadSnapshot(admin, orgId, row.deal_id);
  if (!snap || snap.deal.deleted_at) return { status: 'cancelled', reason: 'lead excluído' };
  // sem conferência humana, o envio automático só vale enquanto o lead está na etapa
  if (row.origin === 'rule' && !reviewed) {
    if (snap.deal.is_won || snap.deal.is_lost) return { status: 'cancelled', reason: 'lead ganho ou perdido' };
    if (snap.deal.stage_id !== row.stage_id) return { status: 'cancelled', reason: 'lead mudou de etapa antes do envio' };
  }
  const data = resolveVariables(spec.variables, snap.ctx, spec.overrides);
  const values = Object.fromEntries(data.map(v => [v.de.slice(2, -2), v.para]));
  const identity = spec.confirmed_signer ?? identityFromForm(values, spec.variables, snap.contact);
  const signer = { name: identity.name.trim(), email: signerEmail(identity.email), phone: signerPhone(identity.phone) };
  if (spec.agent_delivery === 'signed_only') spec = { ...spec, agent_signer: signer };
  if (!fullSignerName(signer.name)) return { status: 'failed', error: 'Confira o nome completo de quem vai assinar.', retry: false };
  if (identity.phone && !signer.phone) return { status: 'failed', error: 'Confira o telefone com DDD de quem vai assinar.', retry: false };
  for (const entry of data) {
    const label = entry.de.slice(2, -2);
    const field = signerField(label, spec.variables[label]);
    if (field) entry.para = signer[field] || (field === 'email' ? ' ' : '');
  }

  const send: SendChannel = spec.signer.send ?? 'crm_whatsapp';
  const phone = splitPhone(signer.phone);
  if ((send === 'zapsign_whatsapp' || ['tokenWhatsapp', 'tokenSms'].includes(spec.signer.auth_mode ?? '')) && !phone.number)
    return { status: 'failed', error: 'O signatário precisa de telefone para a opção escolhida.', retry: false };
  if ((send === 'zapsign_email' || spec.signer.auth_mode === 'tokenEmail') && !signer.email)
    return { status: 'failed', error: 'A opção escolhida exige e-mail. Escolha outro modo de envio ou de autenticação.', retry: false };

  const client = deps.client ?? clientFor(settings, deps.fetchImpl);
  const docName = renderTemplate(spec.doc_name?.trim() || `${spec.template_name || 'Documento'} - {{contato.nome}}`, {
    contato: { nome: signer.name, primeiro_nome: signer.name.split(/\s+/)[0] ?? '' },
    negocio: { titulo: snap.ctx.deal.title },
  }).slice(0, 255);

  let doc: ZapSignDoc;
  let isPackage = false;
  let members: SignatureRequest['package_members'];
  try {
    const tpl = officeTemplates(await client.listTemplates()).find(t => t.token === spec.template_token);
    if (!tpl) return { status: 'failed', error: 'Selecione um modelo principal ativo na conta ZapSign.', retry: false };
    isPackage = !!tpl.extra_templates?.length;
    members = tpl.extra_templates?.map(({ token, name }) => ({ token, name }));
    if (isPackage) {
      // Só filtros simples: o PostgREST reaplica or()/and() às linhas devolvidas
      // pela alteração, onde `request` não existe (select=id) e já estaria alterado.
      // A reserva vale apenas sobre o estado lido: sem marca ou marcado como conferido.
      const reserve = admin.from('deal_signatures').update({ request: { ...spec, confirmed_signer: signer,
        package_members: members, package_unverified: true } }).eq('organization_id',orgId).eq('id',row.id).eq('status','processing');
      const armed = await (spec.package_unverified === false
        ? reserve.eq('request->>package_unverified','false')
        : reserve.is('request->>package_unverified',null)).select('id').maybeSingle();
      if (armed.error || !armed.data) return { status:'failed',error:'Não foi possível reservar o pacote para este envio.',retry:false };
    }
    doc = await createTemplatePackage(client, tpl, {
      template_id: spec.template_token,
      name: docName,
      signer_name: signer.name,
      ...(signer.email ? { signer_email: signer.email } : {}),
      signer_phone_country: phone.country || undefined,
      signer_phone_number: phone.number || undefined,
      data,
      lang: 'pt-br',
      external_id: row.id,
      send_automatic_email: send === 'zapsign_email',
      send_automatic_whatsapp: send === 'zapsign_whatsapp',
      allow_refuse_signature: spec.signer.allow_refuse !== false,
      metadata: [
        { key: 'crm_deal_id', value: row.deal_id },
        { key: 'crm_signature_id', value: row.id },
      ],
    }, async token => {
      const bound = await admin.from('deal_signatures').update({doc_token:token}).eq('organization_id',orgId).eq('id',row.id);
      if (bound.error) throw new Error('Falha ao salvar a referência do envelope.');
    });
  } catch (err) {
    if (err instanceof PackageError) {
      await admin.from('deal_signatures').update({...(err.docToken ? { doc_token: err.docToken } : {}),
        request:{ ...spec, confirmed_signer: signer, package_members: members, package_attachment_models:err.attachmentModels, package_unverified:true }}).eq('id',row.id).eq('organization_id',orgId);
      return { status: 'failed', error: err.message, retry: false };
    }
    const e = err as ZapSignError;
    if (isPackage && e instanceof ZapSignError && [400,401,402,403,404,422].includes(e.status))
      await admin.from('deal_signatures').update({request:spec}).eq('organization_id',orgId).eq('id',row.id).is('doc_token',null);
    // token recusado, modelo inexistente ou dado inválido: não adianta tentar de novo
    const retry = !(e instanceof ZapSignError) || e.status === 0 || e.status === 429 || e.status >= 500;
    return { status: 'failed', error: errorMessage(err), retry };
  }

  const clientToken = agentContactToken(doc.signers ?? [], signer);
  const signers: StoredSigner[] = (doc.signers ?? []).map(s => toStoredSigner(s, s.token === clientToken ? 'contact' : 'extra'));
  const main = signers.find(s => s.role === 'contact') ?? null;

  // Avisos do que a ZapSign não aplicou. Vão na nota do envio: finishSend regrava
  // last_error com ela, então um aviso gravado só na linha se perderia.
  const warnings: string[] = [];
  // autenticação e exigências do signatário principal (não dá para passar na criação por modelo)
  if (main) {
    const patch: Record<string, unknown> = {};
    if (spec.signer.auth_mode && spec.signer.auth_mode !== 'assinaturaTela') patch.auth_mode = spec.signer.auth_mode;
    if (spec.signer.require_cpf) patch.require_cpf = true;
    if (spec.signer.require_selfie_photo) patch.require_selfie_photo = true;
    if (spec.signer.require_document_photo) patch.require_document_photo = true;
    if (Object.keys(patch).length > 0) {
      try {
        await client.updateSigner(main.token, patch);
      } catch (err) {
        // o documento já existe: segue com o padrão e registra o aviso
        warnings.push(`exigências do signatário não aplicadas: ${errorMessage(err)}`);
      }
    }
  }

  // outros signatários (advogado, testemunha)
  for (const extra of spec.extra_signers ?? []) {
    if (!extra.name?.trim()) continue;
    const p = splitPhone(normalizePhoneE164(extra.phone ?? ''));
    try {
      const added = await client.addSigner(doc.token, {
        name: extra.name.trim(),
        email: extra.email?.trim() || undefined,
        phone_country: p.country || undefined,
        phone_number: p.number || undefined,
        qualification: extra.qualification?.trim() || undefined,
        send_automatic_email: !!extra.email?.trim(),
      });
      signers.push(toStoredSigner(added, 'extra'));
    } catch (err) {
      warnings.push(`signatário extra "${extra.name}" não adicionado: ${errorMessage(err)}`);
    }
  }

  const signUrl = main?.sign_url ?? (main ? signerLink(main.token) : null);
  const persisted = await admin
    .from('deal_signatures')
    .update({
      doc_token: doc.token,
      doc_name: docName,
      template_token: spec.template_token,
      template_name: spec.template_name ?? null,
      signers,
      sign_url: signUrl,
      request: isPackage ? { ...spec, confirmed_signer: signer, package_members: members, package_unverified: false } :
        (row.request ? spec : { ...spec, overrides: undefined }),
      contact_id: snap.contact.id,
      updated_at: nowIso(),
    })
    .eq('organization_id',orgId).eq('id',row.id).eq('status','processing').select('id').maybeSingle();
  if (persisted.error || !persisted.data) return {status:'failed',retry:false,
    error:isPackage ? new PackageError(doc.token).message : 'Documento criado. Confira o envelope na ZapSign antes de prosseguir.'};

  // Link pelo WhatsApp do CRM (fica na conversa, sem custo na ZapSign)
  let sentVia: SendChannel = send;
  let note: string | undefined;
  if (isPackage && (send === 'zapsign_email' || send === 'zapsign_whatsapp')) {
    try {
      if (!main) throw new Error('Signatário do cliente não identificado.');
      await client.updateSigner(main.token, { send_automatic_email: send === 'zapsign_email', send_automatic_whatsapp: send === 'zapsign_whatsapp' });
    } catch {
      sentVia = 'link';
      note = 'Pacote pronto. A ZapSign não confirmou o convite ao cliente; confira o envio antes de repetir.';
    }
  }
  if (send === 'crm_whatsapp') {
    const r = await sendLinkViaCrm(admin, orgId, snap, signUrl, docName, signer.name, spec.signer.message);
    if (!r.ok) {
      sentVia = 'link';
      note = r.reason;
    }
  }
  return { status: 'pending', sent_via: sentVia, note: [note, ...warnings].filter(Boolean).join('; ') || undefined };
}

function parentEnvelopeEvents(admin: SupabaseClient, org: string, id: string) {
  return admin.from('zapsign_webhook_events').select('doc_token')
    .eq('organization_id', org).eq('payload->>external_id', id)
    .or('payload->>parent_doc_token.is.null,payload->>parent_doc_token.eq.')
    .not('doc_token','is',null);
}

/** Reconcile a reviewed, manually issued package. Never issue, invite, or replay stage actions. */
export async function recoverManualPackage(admin: SupabaseClient, scope: {
  organizationId: string; dealId: string; signatureId: string; userId: string; providerToken?: string;
}, deps: SendDeps = {}) {
  const { organizationId: org, dealId, signatureId } = scope;
  const read = await admin.from('deal_signatures').select('*').eq('organization_id', org)
    .eq('deal_id', dealId).eq('id', signatureId).maybeSingle();
  if (read.error) throw new Error(read.error.message);
  const row = read.data as SignatureRow | null;
  const spec = row?.request;
  if (!row || !spec || row.origin === 'agent') throw new Error('Esta tentativa de emissão manual não foi localizada.');
  const failed = row.status === 'failed' && (spec.package_unverified || /pacote completo/i.test(row.last_error || ''));
  if (!failed && !(spec.package_recovered && row.status === 'pending'))
    throw new Error('Atualize a aba Contrato para conferir a situação deste envelope.');
  const settings = await loadZapSignSettings(admin, org);
  if (!settings) throw new Error('Conecte a ZapSign para consultar o envelope.');
  const client = deps.client ?? clientFor(settings, deps.fetchImpl);
  // A token can be missing when the provider created the envelope but the POST timed out.
  // Get one exact parent candidate, then explicitly reject any other distinct candidate.
  const parents = () => parentEnvelopeEvents(admin, org, row.id);
  let token = row.doc_token;
  if (!token) {
    const found = await parents().limit(1).maybeSingle();
    if (found.error) throw new Error(found.error.message);
    token = found.data?.doc_token;
  }
  const manualLookup = !token && !!scope.providerToken;
  token ||= scope.providerToken ?? null;
  if (!token) throw new Error('A ZapSign ainda não identificou o envelope. Se já o encontrou em Documentos na ZapSign, informe o identificador dele.');
  const conflict = await parents().neq('doc_token', token).limit(1).maybeSingle();
  if (conflict.error) throw new Error(conflict.error.message);
  if (conflict.data) throw new Error('Existe mais de um envelope para esta tentativa. A equipe precisa conferir na ZapSign.');
  const doc = await client.getDoc(token);
  if (doc.token !== token || ((manualLookup || doc.external_id) && doc.external_id !== row.id))
    throw new Error('A referência deste envelope não corresponde à tentativa do CRM.');
  if (failed && (!row.doc_token || !spec.package_unverified)) {
    const bind = await admin.from('deal_signatures').update({ doc_token: token, request: { ...spec, package_unverified: true } })
      .eq('organization_id', org).eq('id', row.id).eq('status', 'failed');
    if (bind.error) throw new Error('Não foi possível vincular o envelope a esta tentativa.');
  }
  const members = spec.package_members ?? (await client.getTemplate(spec.template_token)).extra_templates;
  if (!members?.length || new Set(members.map(m=>m.token)).size !== members.length ||
      (spec.package_expected && members.length !== spec.package_expected))
    throw new Error('Confira a composição do modelo na ZapSign. O envelope continua vinculado ao CRM.');
  const { remaining } = remainingAttachments(members, doc.extra_docs, spec.package_attachment_models);
  if (remaining.size) throw new Error('Confira no mesmo envelope da ZapSign os anexos que faltam: ' +
    [...remaining.values()].map(e=>e.name).join(', ') + '. Depois, consulte novamente.');
  if (!['pending','signed','refused','expired','deleted'].includes(doc.status))
    throw new Error('A ZapSign ainda não confirmou a situação do envelope.');
  const identity = spec.confirmed_signer ?? identityFromForm(spec.overrides ?? {}, spec.variables, {name:'',phone:'',email:''});
  const contact = agentContactToken(doc.signers ?? [], identity);
  const signers = (doc.signers ?? []).map(s => toStoredSigner(s, s.token === contact ? 'contact' : 'extra'));
  // A package failure happens before signer options and extra invitations are applied.
  // Only expose a link for a verified contact with no outstanding signing requirements.
  const options = spec.signer;
  const mayCopy = contact && fullSignerName(identity.name) && signerPhone(identity.phone) && !spec.extra_signers?.length && !options.require_cpf && !options.require_document_photo &&
    !options.require_selfie_photo && (!options.auth_mode || options.auth_mode === 'assinaturaTela');
  const link = mayCopy ? signers.find(s=>s.token === contact)?.sign_url ?? null : null;
  const signedTimes = signers.map(s=>s.signed_at).filter((at): at is string=>!!at && Number.isFinite(Date.parse(at)));
  const signedAt = signedTimes.length ? new Date(Math.max(...signedTimes.map(at=>Date.parse(at)))).toISOString() : null;
  const saved = await admin.from('deal_signatures').update({
    doc_token: token, doc_name: doc.name || row.doc_name, status: doc.status, signers,
    sign_url: doc.status === 'pending' ? link : null,
    request: { ...spec, package_members: members, package_unverified: false, package_recovered: true },
    ...(doc.status === 'signed' ? { signed_at: row.signed_at ?? signedAt } : {}),
    last_error: doc.status === 'pending' && !link ? 'Confira os signatários e as exigências do envelope na ZapSign.' : null,
    updated_at: nowIso(),
  }).eq('organization_id',org).eq('id',row.id).eq('status',row.status).select('id').maybeSingle();
  if (saved.error) throw new Error(saved.error.message);
  if (saved.data && (failed || doc.status !== row.status)) {
    const bound = { ...row, doc_token: token, doc_name: doc.name };
    const file = doc.status === 'signed' ? await storeSignedFile(admin, bound, doc.signed_file ?? null, deps) : null;
    await recordEvent(admin, bound, 'recovered', { status: doc.status, file_id: file?.id, file_error: file?.error },
      { kind: 'user', id: scope.userId });
  }
  return { id: row.id };
}

export function toStoredSigner(s: ZapSignSigner, role: StoredSigner['role']): StoredSigner {
  return {
    token: s.token,
    name: s.name,
    email: s.email ?? null,
    phone: s.phone_number ? `+${s.phone_country ?? ''}${s.phone_number}` : null,
    sign_url: s.sign_url ?? (s.token ? signerLink(s.token) : null),
    status: s.status,
    signed_at: s.signed_at ?? null,
    role,
  };
}

/** Select only this client's signing link, including when the office is listed first. */
export function agentContactToken(list: ZapSignSigner[], identity?: SignatureRequest['agent_signer']) {
  if (!identity) return null;
  const normalize = (value?:string|null) => (value || '').trim().normalize('NFKC').toLocaleLowerCase('pt-BR');
  const matches = list.filter(s => {
    const phone = ((s.phone_country || '') + (s.phone_number || '')).replace(/\D/g,'');
    const expectedPhone = identity.phone.replace(/\D/g,'');
    if (phone && expectedPhone && phone !== expectedPhone) return false;
    if (s.email && identity.email && normalize(s.email) !== normalize(identity.email)) return false;
    return s.token && normalize(s.name) === normalize(identity.name);
  });
  return matches.length === 1 ? matches[0].token : null;
}

async function sendLinkViaCrm(
  admin: SupabaseClient,
  orgId: string,
  snap: LeadSnapshot,
  signUrl: string | null,
  docName: string,
  signerName: string,
  message: string | undefined
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!signUrl) return { ok: false, reason: 'a ZapSign não devolveu o link de assinatura' };
  const resolved = await resolveDealConversation(admin, orgId, { id: snap.deal.id, contact_id: snap.deal.contact_id });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const conv = resolved.conversation;
  if (!conv) return { ok: false, reason: 'o lead não tem conversa no WhatsApp' };
  if (!conv.connection_id) return { ok: false, reason: 'a conversa não tem número conectado' };
  const phone = (conv.wa_phone ?? '').trim();
  if (!phone) return { ok: false, reason: 'a conversa não tem telefone' };
  const connection = (await getConnectionByIdForOrg(admin, orgId, conv.connection_id)) as WaConnectionRow | null;
  if (!connection) return { ok: false, reason: 'o número da conversa não existe mais' };
  if (connection.status !== 'connected') return { ok: false, reason: 'o número da conversa está desconectado' };
  if (connection.provider === 'meta_cloud') {
    const lastIn = await lastInboundAt(admin, resolved.all.map((c) => c.id));
    if (!getServiceWindow(lastIn).open) return { ok: false, reason: 'janela de 24 h fechada na API oficial da Meta' };
  }
  // sem {{link}} na mensagem, ensureSignLink põe o link no final; vazia, vai a padrão
  const text = renderTemplate(ensureSignLink(message ?? ''), {
    nome: signerName,
    primeiro_nome: signerName.split(/\s+/)[0] ?? '',
    link: signUrl,
    documento: docName,
    negocio: { titulo: snap.ctx.deal.title },
  }).trim();
  try {
    await sendTextToConversation(admin, { organizationId: orgId, conversationId: conv.id, connection, phone, text });
  } catch (err) {
    return { ok: false, reason: `falha ao enviar pelo WhatsApp: ${errorMessage(err)}` };
  }
  return { ok: true };
}

/** Grava o resultado do envio e o registra no histórico do lead. */
export async function finishSend(admin: SupabaseClient, row: SignatureRow, outcome: SendOutcome): Promise<void> {
  const now = nowIso();
  if (outcome.status === 'pending') {
    const result = await admin
      .from('deal_signatures')
      .update({ status: 'pending', sent_via: outcome.sent_via, sent_at: now, lock_until: null, last_error: outcome.note ?? null, updated_at: now })
      .eq('organization_id',row.organization_id).eq('id', row.id).eq('status','processing').select('id').maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return;
    await recordEvent(admin, row, 'sent', { sent_via: outcome.sent_via, note: outcome.note ?? null });
    return;
  }
  if (outcome.status === 'cancelled') {
    await admin.from('deal_signatures').update({ status: 'cancelled', lock_until: null, last_error: outcome.reason, updated_at: now }).eq('id', row.id).eq('status','processing');
    return;
  }
  const giveUp = !outcome.retry || row.attempts >= MAX_ATTEMPTS;
  const result = await admin
    .from('deal_signatures')
    .update(
      giveUp
        ? { status: 'failed', lock_until: null, last_error: outcome.error, updated_at: now }
        : { status: 'queued', lock_until: null, last_error: outcome.error, next_attempt_at: new Date(Date.now() + 2 * 60_000 * row.attempts).toISOString(), updated_at: now }
    )
    .eq('organization_id',row.organization_id).eq('id', row.id).eq('status','processing').select('id').maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (giveUp && result.data) await recordEvent(admin, row, 'failed', { error: outcome.error });
}

export async function recordEvent(
  admin: SupabaseClient,
  row: Pick<SignatureRow, 'organization_id' | 'deal_id' | 'id' | 'doc_name' | 'doc_token'> & { template_name?: string | null },
  status: string,
  detail: Record<string, unknown>,
  actor: { kind: 'integration' | 'user'; id?: string | null } = { kind: 'integration' }
): Promise<void> {
  await admin.from('deal_events').insert({
    organization_id: row.organization_id,
    deal_id: row.deal_id,
    kind: SIGNATURE_EVENT_KIND,
    field: row.doc_name ?? row.template_name ?? null,
    new_value: status,
    detail: { provider: 'zapsign', signature_id: row.id, doc_token: row.doc_token, ...detail },
    actor_kind: actor.kind,
    ...(actor.id ? { actor_id: actor.id } : {}),
  });
}

/** Tick: processa a fila (entradas em etapa com regra e tentativas pendentes). */
export async function processQueuedSignatures(
  admin: SupabaseClient,
  opts: { limit?: number; deadlineMs?: number; deps?: SendDeps } = {}
): Promise<{ processed: number }> {
  let processed = 0;
  const { data, error } = await admin.rpc('deal_signature_claim', { p_limit: opts.limit ?? 5 });
  if (error) return { processed }; // migração ainda não aplicada
  for (const raw of (data ?? []) as SignatureRow[]) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    const row = { ...raw, request: raw.request ?? null, signers: raw.signers ?? [] };
    try {
      if (row.attempts > MAX_ATTEMPTS) {
        await finishSend(admin, row, { status: 'failed', error: row.last_error || 'muitas tentativas', retry: false });
      } else {
        await finishSend(admin, row, await sendSignature(admin, row, opts.deps));
      }
    } catch (err) {
      await finishSend(admin, row, { status: 'failed', error: errorMessage(err), retry: true });
    }
    processed++;
  }
  return { processed };
}

/**
 * Envio conferido por uma pessoa (tela do lead ou modal ao mudar de etapa):
 * grava a linha e executa na hora. Com `ruleStageId`, aproveita a linha que o
 * banco preparou ao entrar na etapa ('review'); sem ela, cria um envio manual.
 */
export async function createManualSignature(
  admin: SupabaseClient,
  input: { organizationId: string; dealId: string; userId: string; request: SignatureRequest; ruleStageId?: string | null; confirmedAbsent?: string[]; deps?: SendDeps }
): Promise<{ row: SignatureRow; outcome: SendOutcome }> {
  const { data: deal } = await admin.from('deals').select('id, stage_id, contact_id').eq('organization_id', input.organizationId).eq('id', input.dealId).maybeSingle();
  if (!deal) throw new Error('Lead não encontrado');
  const d = deal as { id: string; stage_id: string | null; contact_id: string | null };
  // Only the server can bind post-signature automation to the current service.
  const request = { ...input.request };
  delete request.agent_delivery;
  delete request.agent_id;
  delete request.conversation_id;
  delete request.connection_id;
  delete request.recipient;
  delete request.agent_signer;
  Object.assign(request, await manualAgentFollowup(admin, { organizationId: input.organizationId,
    dealId: d.id, contactId: d.contact_id, templateToken: request.template_token }));
  // The original request may have lost its HTTP response after ZapSign accepted it.
  // Guide the regular Send button to the existing envelope, including legacy failures.
  const failed = await admin.from('deal_signatures').select('id,doc_token,last_error,request')
    .eq('organization_id',input.organizationId).eq('deal_id',d.id).eq('template_token',input.request.template_token)
    .in('origin',['manual','rule']).eq('status','failed');
  if (failed.error) throw new Error('Falha ao conferir as tentativas anteriores deste modelo.');
  const uncertain: string[] = [];
  for (const prior of failed.data ?? []) {
    if (!prior.request?.package_unverified && !/pacote completo/i.test(prior.last_error ?? '')) continue;
    const event = prior.doc_token ? null : await parentEnvelopeEvents(admin,input.organizationId,prior.id).limit(1).maybeSingle();
    if (event?.error) throw new Error('Falha ao consultar o envelope da tentativa anterior.');
    if (prior.doc_token || event?.data) throw new Error('Já existe um envelope para esta tentativa. Na aba Contrato, use Recuperar envelope da ZapSign.');
    uncertain.push(prior.id);
  }
  if (uncertain.some(id=>!input.confirmedAbsent?.includes(id))) throw new UnconfirmedEnvelopeError(uncertain);
  const lockUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  let inserted: SignatureRow | null = null;
  if (input.ruleStageId) {
    const { data: claimed, error: claimError } = await admin
      .from('deal_signatures')
      .update({
        status: 'processing',
        attempts: 1,
        lock_until: lockUntil,
        requested_by: input.userId,
        template_token: input.request.template_token,
        template_name: input.request.template_name ?? null,
        request,
        last_error: null,
        updated_at: nowIso(),
      })
      .eq('organization_id', input.organizationId)
      .eq('deal_id', d.id)
      .eq('stage_id', input.ruleStageId)
      .eq('origin', 'rule')
      .eq('status', 'review')
      .select('*')
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);
    inserted = (claimed as SignatureRow | null) ?? null;
  }
  if (!inserted) {
    const { data, error } = await admin
      .from('deal_signatures')
      .insert({
        organization_id: input.organizationId,
        deal_id: d.id,
        contact_id: d.contact_id,
        stage_id: d.stage_id,
        origin: 'manual',
        requested_by: input.userId,
        template_token: input.request.template_token,
        template_name: input.request.template_name ?? null,
        status: 'processing',
        attempts: 1,
        lock_until: lockUntil,
        request,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    inserted = data as SignatureRow;
  }
  const row = { ...inserted, request, signers: [] };
  let outcome: SendOutcome;
  try {
    outcome = await sendSignature(admin, row, input.deps);
  } catch (err) {
    outcome = { status: 'failed', error: errorMessage(err), retry: false };
  }
  if (outcome.status === 'failed') outcome = { ...outcome, retry: false }; // manual: não fica tentando sozinho
  await finishSend(admin, row, outcome);
  const { data: fresh } = await admin.from('deal_signatures').select('*').eq('id', row.id).maybeSingle();
  return { row: (fresh as SignatureRow) ?? row, outcome };
}

/**
 * Descarta um contrato que ainda estava aguardando conferência (nada foi
 * criado na ZapSign). Se o lead entrar de novo na etapa, o banco prepara outro.
 */
export async function discardSignature(
  admin: SupabaseClient,
  input: { organizationId: string; dealId: string; signatureId: string; userId: string }
): Promise<SignatureRow | null> {
  const { data, error } = await admin
    .from('deal_signatures')
    .update({ status: 'cancelled', last_error: 'descartado antes do envio', lock_until: null, updated_at: nowIso() })
    .eq('organization_id', input.organizationId)
    .eq('deal_id', input.dealId)
    .eq('id', input.signatureId)
    .eq('status', 'review')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data as SignatureRow | null) ?? null;
  if (!row) return null;
  await recordEvent(admin, row, 'discarded', {}, { kind: 'user', id: input.userId });
  return row;
}

// ---------------------------------------------------------------- webhook da ZapSign

export type WebhookPayload = {
  parent_doc_token?: string | null;
  event_type?: string;
  token?: string;
  status?: string;
  name?: string;
  external_id?: string | null;
  signed_file?: string | null;
  original_file?: string | null;
  last_update_at?: string;
  rejected_reason?: string | null;
  signers?: ZapSignSigner[];
  signer_who_signed?: ZapSignSigner | null;
  sandbox?: boolean;
};

export function webhookDedupeKey(p: WebhookPayload): string {
  const who = p.signer_who_signed?.token ?? '';
  return [p.event_type ?? '', p.token ?? '', who, p.last_update_at ?? p.status ?? ''].join('|');
}

export type WebhookResult = { action: string; signatureId?: string };

/**
 * Aplica um evento da ZapSign ao lead. Idempotente: estado já aplicado não
 * repete arquivo, histórico nem ações.
 */
export async function handleZapSignWebhook(
  admin: SupabaseClient,
  orgId: string,
  payload: WebhookPayload,
  deps: SendDeps = {}
): Promise<WebhookResult> {
  const docToken = (payload.token ?? '').trim();
  if (!docToken) return { action: 'ignored_no_token' };
  if (payload.parent_doc_token) return { action: 'ignored_attachment' };
  const { data: found, error: readError } = await admin.from('deal_signatures').select('*').eq('organization_id', orgId).eq('doc_token', docToken).maybeSingle();
  if (readError) throw new Error(readError.message);
  let row = found as SignatureRow | null;
  // A verified provider event can arrive before the HTTP response, or after a timeout.
  // Only attach an unclaimed agent reservation in the webhook's own organization.
  if (!row && payload.external_id && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(payload.external_id)) {
    const reservation = await admin.from('deal_signatures').select('request').eq('organization_id',orgId)
      .eq('origin','agent').eq('id',payload.external_id).maybeSingle();
    if (reservation.error) throw new Error(reservation.error.message);
    // Only our completed assembly may make a package pending and release its URL.
    // A doc_created callback can race the POST for the principal or an attachment.
    if (reservation.data?.request?.package_expected) {
      if (payload.event_type === 'doc_created' || payload.event_type === 'created_signer') return { action: 'awaiting_package' };
      throw new Error('Pacote em montagem. Reprocessar após a conferência dos anexos.');
    }
    const contactToken = agentContactToken(payload.signers ?? [],reservation.data?.request?.agent_signer);
    const incoming = (payload.signers ?? []).map(s => toStoredSigner(s, s.token === contactToken ? 'contact' : 'extra'));
    const { data, error } = await admin.from('deal_signatures').update({ doc_token: docToken, status: 'pending',
      doc_name: payload.name ?? null, signers: incoming, sign_url: incoming.find(s => s.role === 'contact')?.sign_url ?? null,
      sent_via: 'link', last_error: null, updated_at: nowIso() })
      .eq('organization_id', orgId).eq('origin', 'agent').eq('id', payload.external_id).is('doc_token', null)
      .in('status', ['processing', 'failed']).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    row = data as SignatureRow | null;
    if (row) await recordEvent(admin, row, 'created', { origin: 'agent' });
    else {
      const reread = await admin.from('deal_signatures').select('*').eq('organization_id', orgId).eq('doc_token', docToken).maybeSingle();
      if (reread.error) throw new Error(reread.error.message);
      row = reread.data as SignatureRow | null;
    }
  }
  if (!row) return { action: 'ignored_unknown_doc' };
  if (row.request?.package_unverified || (row.status === 'failed' && row.request?.package_expected)) return { action: 'package_requires_review' };
  const now = nowIso();
  const event = payload.event_type ?? '';
  const docStatus = (payload.status ?? '').toLowerCase();

  // signatários: atualiza quem abriu/assinou
  const incoming = [...(payload.signers ?? [])];
  const whoSigned = event === 'doc_signed' && payload.signer_who_signed;
  if (whoSigned && !incoming.some(s => s.token === whoSigned.token)) incoming.push(whoSigned);
  const expected = row.request?.agent_delivery ? agentContactToken(incoming,row.request.agent_signer) : null;
  const signers: StoredSigner[] = (row.signers ?? []).map((s) => {
    const u = incoming.find((i) => i.token === s.token);
    return u ? { ...s, role: u.token === expected ? 'contact' : s.role, status: s.status === 'signed' ? 'signed' : u.status, signed_at: u.signed_at ?? s.signed_at, sign_url: u.sign_url ?? s.sign_url } : s;
  });
  for (const i of incoming) if (!signers.some((s) => s.token === i.token)) signers.push(toStoredSigner(i, i.token === expected ? 'contact' : 'extra'));

  const base: Record<string, unknown> = { signers, last_event_at: now, updated_at: now };
  const contactLink = signers.find(s => s.role === 'contact')?.sign_url;
  if (row.origin === 'agent' && !row.sign_url && contactLink) {
    base.sign_url = contactLink;
    base.last_error = null;
  }

  if (event === 'doc_refused' || docStatus === 'refused' || docStatus === 'recusado') {
    if (row.status === 'refused') return { action: 'already_refused', signatureId: row.id };
    await admin.from('deal_signatures').update({ ...base, status: 'refused', refused_at: now, refused_reason: payload.rejected_reason ?? null }).eq('id', row.id);
    await recordEvent(admin, row, 'refused', { reason: payload.rejected_reason ?? null });
    await applyActions(admin, row, actionsOf(row, 'on_refused'), 'refused');
    return { action: 'refused', signatureId: row.id };
  }

  if (event === 'doc_deleted') {
    if (row.status === 'deleted') return { action: 'already_deleted', signatureId: row.id };
    await admin.from('deal_signatures').update({ ...base, status: 'deleted' }).eq('id', row.id);
    await recordEvent(admin, row, 'deleted', {});
    return { action: 'deleted', signatureId: row.id };
  }

  if (event === 'doc_expired' || docStatus === 'expired') {
    if (row.status === 'expired') return { action: 'already_expired', signatureId: row.id };
    await admin.from('deal_signatures').update({ ...base, status: 'expired' }).eq('id', row.id);
    await recordEvent(admin, row, 'expired', {});
    return { action: 'expired', signatureId: row.id };
  }

  if (event === 'doc_signed' || docStatus === 'signed') {
    const allSigned = docStatus === 'signed';
    if (!allSigned) {
      // um dos signatários assinou, faltam outros
      const signedToken = payload.signer_who_signed?.token;
      const confirmed = signedToken && signers.find(s => s.token === signedToken);
      if (confirmed) confirmed.status = 'signed';
      const { error } = await admin.from('deal_signatures').update(base).eq('id', row.id);
      if (error) throw new Error(error.message);
      const who = payload.signer_who_signed?.name;
      await recordEvent(admin, row, 'partial', { signer: who ?? null });
      return { action: 'partially_signed', signatureId: row.id };
    }
    if (row.status === 'signed') {
      if (row.request?.agent_delivery && !row.agent_client_signed_at && signers.some(s=>s.role==='contact')) {
        const enriched = await admin.from('deal_signatures').update(base).eq('organization_id',orgId).eq('id',row.id);
        if (enriched.error) throw new Error(enriched.error.message);
      }
      return { action: 'already_signed', signatureId: row.id };
    }
    const { data: transitioned, error } = await admin.from('deal_signatures').update({ ...base, status: 'signed', signed_at: now })
      .eq('organization_id', orgId).eq('id', row.id).eq('status', row.status).select('id').maybeSingle();
    if (error) throw new Error(error.message);
    if (!transitioned) {
      const current = await admin.from('deal_signatures').select('status').eq('organization_id',orgId).eq('id',row.id).maybeSingle();
      if (current.data?.status === 'signed') return { action:'already_signed', signatureId:row.id };
      throw new Error('O contrato mudou durante a confirmação da assinatura.');
    }
    const file = await storeSignedFile(admin, row, payload.signed_file ?? null, deps);
    await recordEvent(admin, row, 'signed', { signers: signers.map((s) => s.name), file_id: file?.id ?? null, file_error: file?.error ?? null });
    await applyActions(admin, row, actionsOf(row, 'on_signed'), 'signed');
    return { action: 'signed', signatureId: row.id };
  }

  if (event === 'doc_viewed' || event === 'doc_read_confirmation') {
    const firstView = !(row.signers ?? []).some((s) => s.status === 'link-opened' || s.status === 'signed') && signers.some((s) => s.status === 'link-opened');
    await admin.from('deal_signatures').update(base).eq('id', row.id);
    if (firstView) await recordEvent(admin, row, 'viewed', {});
    return { action: firstView ? 'viewed' : 'touch', signatureId: row.id };
  }

  await admin.from('deal_signatures').update(base).eq('id', row.id);
  return { action: `touch:${event || 'unknown'}`, signatureId: row.id };
}

function actionsOf(row: SignatureRow, key: 'on_signed' | 'on_refused'): SignatureActions {
  return row.request?.[key] ?? {};
}

/** Baixa o PDF assinado (o link da ZapSign vence em 60 min) para os anexos do lead. */
async function storeSignedFile(
  admin: SupabaseClient,
  row: SignatureRow,
  signedUrl: string | null,
  deps: SendDeps
): Promise<{ id: string | null; error?: string } | null> {
  if (row.file_id) return { id: row.file_id };
  if (!signedUrl) return { id: null, error: 'sem link do arquivo assinado' };
  try {
    const settings = await loadZapSignSettings(admin, row.organization_id);
    if (!settings) return { id: null, error: 'ZapSign desconectada' };
    const client = deps.client ?? clientFor(settings, deps.fetchImpl);
    const { bytes } = await client.download(signedUrl);
    const path = `${row.deal_id}/zapsign-${row.doc_token}.pdf`;
    const { error: upErr } = await admin.storage.from(DEAL_FILES_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) return { id: null, error: upErr.message };
    const fileName = `${(row.doc_name || 'Documento assinado').replace(/[\\/:*?"<>|]+/g, ' ').trim()} (assinado).pdf`;
    const { data: fileRow, error: fileErr } = await admin
      .from('deal_files')
      .insert({ deal_id: row.deal_id, file_name: fileName, file_path: path, file_size: bytes.byteLength, mime_type: 'application/pdf', created_by: null })
      .select('id')
      .single();
    if (fileErr) return { id: null, error: fileErr.message };
    const id = (fileRow as { id: string }).id;
    await admin.from('deal_signatures').update({ file_id: id, file_path: path, updated_at: nowIso() }).eq('id', row.id);
    return { id };
  } catch (err) {
    return { id: null, error: errorMessage(err) };
  }
}

/** Mover etapa, etiquetar e iniciar robô depois de assinar ou recusar. */
async function applyActions(admin: SupabaseClient, row: SignatureRow, actions: SignatureActions, why: 'signed' | 'refused'): Promise<void> {
  const problems: string[] = [];
  if (actions.tag?.trim()) {
    try {
      await addDealTag(admin, row.organization_id, row.deal_id, actions.tag.trim());
    } catch (err) {
      problems.push(`etiqueta: ${errorMessage(err)}`);
    }
  }
  if (actions.stage_id) {
    try {
      const { data: stage } = await admin.from('board_stages').select('id, board_id').eq('organization_id', row.organization_id).eq('id', actions.stage_id).maybeSingle();
      const st = stage as { id: string; board_id: string } | null;
      if (!st) throw new Error('etapa de destino não existe mais');
      const now = nowIso();
      const { error } = await admin
        .from('deals')
        .update({ board_id: st.board_id, stage_id: st.id, last_stage_change_date: now, updated_at: now })
        .eq('organization_id', row.organization_id)
        .eq('id', row.deal_id);
      if (error) throw new Error(error.message);
    } catch (err) {
      problems.push(`mover etapa: ${errorMessage(err)}`);
    }
  }
  if (actions.bot_id) {
    try {
      const resolved = await resolveDealConversation(admin, row.organization_id, { id: row.deal_id, contact_id: row.contact_id });
      const started = await startBotRun(admin, {
        organizationId: row.organization_id,
        botId: actions.bot_id,
        dealId: row.deal_id,
        contactId: row.contact_id,
        conversationId: resolved.ok ? (resolved.conversation?.id ?? null) : null,
      });
      if (!started.ok) throw new Error(started.error || 'o robô não iniciou');
    } catch (err) {
      problems.push(`robô: ${errorMessage(err)}`);
    }
  }
  if (problems.length > 0) {
    await admin.from('deal_signatures').update({ last_error: `ações após ${why === 'signed' ? 'assinar' : 'recusar'}: ${problems.join('; ')}`, updated_at: nowIso() }).eq('id', row.id);
    await recordEvent(admin, row, 'actions_failed', { problems });
  }
}
