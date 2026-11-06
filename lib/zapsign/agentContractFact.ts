import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignatureRow } from './signatures';

export function clientHasSigned(s: Pick<SignatureRow,'status'|'signers'|'agent_client_signed_at'>) {
  return !!s.agent_client_signed_at || s.status === 'signed' || s.signers.some(p => p.role === 'contact' && (p.status === 'signed' || !!p.signed_at));
}

export async function agentContractFact(db: SupabaseClient, org: string, conversation: string, agent: string, deal: string, contact: string) {
  const {data,error} = await db.from('deal_signatures').select('status, signers, agent_client_signed_at, notices:zapsign_agent_notices(kind,state)')
    .eq('organization_id',org).eq('deal_id',deal).eq('contact_id',contact).eq('origin','agent')
    .contains('request',{conversation_id:conversation,agent_id:agent,agent_delivery:'conversation'})
    .order('created_at',{ascending:false}).limit(1).maybeSingle();
  if (error) return 'Situação da assinatura indisponível. Não confirme criação, envio ou assinatura sem conferir.';
  if (!data) return '';
  const status = data.status === 'signed' ? 'Documento assinado por todos.' :
    clientHasSigned(data) ? 'O cliente assinou. Ainda faltam assinaturas.' :
    data.status === 'pending' ? 'Documento criado. Assinatura do cliente pendente.' : 'Situação do contrato: ' + data.status;
  const notices = data.notices ?? [];
  const sent = (kind:string) => notices.some(n=>n.kind===kind && n.state==='sent');
  return 'Registro da ZapSign: ' + status + (sent('invite') ? ' Link enviado na conversa.' : ' Envio do link ainda não confirmado.') +
    (sent('signed') ? ' O agente já fez o acompanhamento da assinatura; prossiga com a dúvida atual.' : ' O CRM cuida do convite e da mensagem de acompanhamento automaticamente.');
}
