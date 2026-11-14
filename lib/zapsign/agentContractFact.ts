import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignatureRow } from './signatures';

export function clientHasSigned(s: Pick<SignatureRow,'status'|'signers'|'agent_client_signed_at'>) {
  return !!s.agent_client_signed_at || s.status === 'signed' || s.signers.some(p => p.role === 'contact' && (p.status === 'signed' || !!p.signed_at));
}

type ManualScope = { organizationId: string; dealId: string | null; contactId: string | null;
  templateToken: string | null | undefined; silentSince?: string | null };
const factColumns = 'status, origin, request, doc_token, sent_via, sent_at, created_at, signers, agent_client_signed_at, notices:zapsign_agent_notices(kind,state)';

function issuedAt(contract: Pick<SignatureRow, 'created_at' | 'sent_at'>): number {
  // A stage can reserve a review row days before the team issues it. finishSend
  // records sent_at when issuance succeeds, including the link-only option.
  // updated_at is deliberately excluded: later signer callbacks also change it.
  const sent = Date.parse(contract.sent_at ?? '');
  return Number.isFinite(sent) ? sent : Date.parse(contract.created_at);
}

async function issuedManualContract(db: SupabaseClient, scope: ManualScope) {
  if (!scope.dealId || !scope.contactId || !scope.templateToken) return null;
  const { data, error } = await db.from('deal_signatures').select(factColumns)
    .eq('organization_id', scope.organizationId).eq('deal_id', scope.dealId).eq('contact_id', scope.contactId)
    .eq('template_token', scope.templateToken).in('origin', ['manual', 'rule']).in('status', ['pending', 'signed'])
    .not('doc_token', 'is', null);
  if (error) throw new Error('Não foi possível conferir o contrato emitido pela equipe.');
  return data?.filter(contract => !contract.request?.package_unverified)
    .sort((a,b) => issuedAt(b) - issuedAt(a))[0] ?? null;
}

/** The old collection follow-up no longer applies after the team issues this
 * contract. A read failure must defer the proactive send, never assume absence. */
export async function manualContractIssued(db: SupabaseClient, scope: ManualScope): Promise<boolean> {
  const contract = await issuedManualContract(db, scope);
  if (!contract) return false;
  // A later client reply begins a new cycle with the contract fact in context.
  // Only cancel the old data-collection cycle, not the post-sale service.
  return !scope.silentSince || issuedAt(contract) >= Date.parse(scope.silentSince);
}

export async function agentContractFact(db: SupabaseClient, org: string, conversation: string, agent: string, deal: string, contact: string, template?: string) {
  const {data,error} = await db.from('deal_signatures').select(factColumns)
    .eq('organization_id',org).eq('deal_id',deal).eq('contact_id',contact).eq('origin','agent')
    .contains('request',{conversation_id:conversation,agent_id:agent,agent_delivery:'conversation'})
    .order('created_at',{ascending:false}).limit(1).maybeSingle();
  if (error) return 'Situação da assinatura indisponível. Não confirme criação, envio ou assinatura sem conferir.';
  let manual;
  try {
    manual = await issuedManualContract(db, { organizationId: org, dealId: deal, contactId: contact, templateToken: template });
  } catch {
    return 'Situação da assinatura indisponível. Não confirme criação, envio ou assinatura sem conferir.';
  }
  const current = manual && (!data || issuedAt(manual) >= issuedAt(data)) ? manual : data;
  if (!current) return '';
  const status = current.status === 'signed' ? 'Documento assinado por todos.' :
    clientHasSigned(current) ? 'O cliente assinou. Ainda faltam assinaturas.' :
    current.status === 'pending' ? 'Documento criado. Assinatura do cliente pendente.' : 'Situação do contrato: ' + current.status;
  const notices = current.notices ?? [];
  const sent = (kind:string) => notices.some(n=>n.kind===kind && n.state==='sent');
  if (current.origin !== 'agent') {
    const delivery = current.sent_at && current.sent_via && current.sent_via !== 'link'
      ? ' Convite enviado pela equipe via ' + current.sent_via + '.' : ' Link gerado; envio ao cliente não confirmado.';
    return 'Registro da ZapSign: ficha concluída pela equipe e contrato já emitido para este lead. ' + status + delivery +
      (sent('signed') ? ' Acompanhamento da assinatura já realizado.' :
        current.request?.agent_delivery === 'signed_only' ? ' Acompanhamento da assinatura vinculado a este atendimento.' : ' Emissão anterior sem acompanhamento automático vinculado.');
  }
  return 'Registro da ZapSign: ' + status + (sent('invite') ? ' Link enviado na conversa.' : ' Envio do link ainda não confirmado.') +
    (sent('signed') ? ' O agente já fez o acompanhamento da assinatura; prossiga com a dúvida atual.' : ' O CRM cuida do convite e da mensagem de acompanhamento automaticamente.');
}
