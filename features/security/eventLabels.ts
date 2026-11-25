/** Nome em português de cada evento do registro de segurança. */
const LABELS: Record<string, string> = {
  'superadmin.org.create': 'Organização criada',
  'superadmin.org.update': 'Organização alterada',
  'superadmin.org.delete': 'Organização excluída',
  'superadmin.org.switch': 'Super admin entrou em uma organização',
  'superadmin.org.ai_agents': 'Agentes de IA liberados ou bloqueados',
  'superadmin.user.create': 'Usuário criado pelo super admin',
  'superadmin.user.promote': 'Usuário promovido a super admin',
  'superadmin.user.demote': 'Super admin rebaixado',
  'superadmin.user.memberships': 'Organizações do super admin alteradas',
  'superadmin.user.password_reset': 'Senha alterada pelo super admin',
  'superadmin.setup': 'Configuração inicial do super admin',
  'team.invite.created': 'Convite criado',
  'team.invite.revoked': 'Convite cancelado',
  'team.invite.accepted': 'Convite aceito',
  'team.member.added': 'Membro adicionado',
  'team.member.removed': 'Membro removido',
  'user.role_changed': 'Papel de usuário alterado',
  'api_key.created': 'Chave de API criada',
  'api_key.revoked': 'Chave de API revogada',
  'ai.settings.changed': 'Configuração de IA alterada',
  'whatsapp.connection.saved': 'Conexão do WhatsApp salva',
  'whatsapp.connection.removed': 'Conexão do WhatsApp desconectada',
  'integration.zapsign.changed': 'Integração ZapSign alterada',
  'webhook.outbound.created': 'Webhook de saída criado',
  'webhook.outbound.changed': 'Webhook de saída alterado',
  'webhook.outbound.removed': 'Webhook de saída removido',
  'webhook.inbound.created': 'Webhook de entrada criado',
  'webhook.inbound.changed': 'Webhook de entrada alterado',
  'webhook.inbound.removed': 'Webhook de entrada removido',
  'data.contacts.exported': 'Contatos exportados',
  'public_api.invalid_key': 'Chave de API inválida usada',
  'auth.login_failed': 'Senha recusada no login',
  'auth.login': 'Login realizado',
  'rate_limit.exceeded': 'Limite de requisições estourado',
};

export function eventLabel(action: string): string {
  return LABELS[action] ?? action;
}

const SEVERITY: Record<string, string> = { info: 'Informativo', warning: 'Atenção', critical: 'Crítico' };

export function severityLabel(severity: string): string {
  return SEVERITY[severity] ?? severity;
}

/** Detalhes do evento em pares "campo: valor", prontos para exibir. */
export function detailLines(details: Record<string, unknown> | null | undefined): Array<[string, string]> {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      let text: string;
      if (typeof v === 'boolean') text = v ? 'sim' : 'não';
      else if (Array.isArray(v)) text = v.length ? v.map(String).join(', ') : 'nenhum';
      else if (typeof v === 'object') text = JSON.stringify(v);
      else text = String(v);
      return [k.replace(/_/g, ' '), text];
    });
}
