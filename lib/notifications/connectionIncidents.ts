import type { RequireOrgResult } from '@/lib/whatsapp/api';
import type { VisibilityRules } from '@/lib/permissions/types';
import { connectionAllowed } from '@/lib/permissions/server';
import type { Notice } from './types';
import { incidentMailConfigured } from '@/lib/whatsapp/connectionIncidentEmail';

type Auth = Extract<RequireOrgResult, { ok: true }>;
interface IncidentNotice {
  id: string; phase: 'opened' | 'resolved'; created_at: string; mail_state: string;
  connection_id: string; line_label: string; reason: string;
}

export async function connectionIncidentNotices(auth: Auth, rules: VisibilityRules | null, before: string): Promise<Notice[]> {
  // Always include open outages, even after an offline interval. Return recent recoveries as well.
  const { data, error } = await auth.admin.rpc('wa_connection_bell', {
    p_org: auth.user.organizationId, p_user: auth.user.id, p_until: before,
  });
  if (error) throw error;
  return ((data ?? []) as IncidentNotice[]).flatMap(row => {
    if (!connectionAllowed(rules,row.connection_id)) return [];
    const recovered = row.phase === 'resolved';
    const uncertain = row.reason === 'verification_unavailable';
    const title = recovered ? 'WhatsApp reconectado' : uncertain ? 'Verifique a conexão do WhatsApp' : 'Falha na conexão do WhatsApp';
    let message = row.reason === 'number_changed' && !recovered
      ? `${row.line_label} · O telefone pareado mudou. Confira a identidade antes de retomar os envios.`
      : `${row.line_label} · Abra a conexão para consultar o estado do número.`;
    if (row.mail_state === 'unconfirmed') {
      message += ' O envio do e-mail ficou sem confirmação. Confira a pasta Enviados do remetente.';
    } else if (row.mail_state === 'failed') {
      message += ' O provedor recusou o aviso por e-mail.';
    } else if (row.mail_state === 'pending' && !incidentMailConfigured()) {
      message += ' O envio do aviso por e-mail aguarda a configuração de um remetente.';
    }
    return [{ id: `wa-line-${row.id}`, kind: 'alert', category: recovered ? undefined : 'connection_outage', tone: recovered ? 'green' : 'red',
      title, message, href: '/conexao-whatsapp', createdAt: row.created_at }];
  });
}
