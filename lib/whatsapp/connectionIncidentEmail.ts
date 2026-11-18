import type { SupabaseClient } from '@supabase/supabase-js';

type Provider = 'hostinger' | 'resend';
interface IncidentMail {
  id: string;
  lease_token: string;
  mail_provider: Provider;
  phase: 'opened' | 'resolved';
  recipient_email: string;
  line_label: string;
  reason: string;
  occurred_at: string;
}

function mailConfiguration() {
  const from = process.env.WA_CONNECTION_ALERT_EMAIL_FROM?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const token = process.env.WA_CONNECTION_HOSTINGER_MAIL_TOKEN?.trim();
  const mailbox = process.env.WA_CONNECTION_HOSTINGER_MAILBOX_ID?.trim();
  const start = process.env.WA_CONNECTION_ALERT_EMAIL_START_AT?.trim() ?? '';
  const startAt = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(start) && Number.isFinite(Date.parse(start))
    ? new Date(start).toISOString() : null;
  const sender = from?.match(/^(?:([^<>\r\n]+)\s+<([^<>\s@]+@[^<>\s@]+)>|([^<>\s@]+@[^<>\s@]+))$/);
  const hostinger = token && mailbox && startAt && sender ? { token, mailbox, startAt, displayName: sender[1]?.trim() } : null;
  const resend = resendKey && from ? { token: resendKey, from } : null;
  const providers: Provider[] = [];
  if (hostinger) providers.push('hostinger');
  if (resend) providers.push('resend');
  return { hostinger, resend, providers };
}

export function incidentMailConfigured() {
  return mailConfiguration().providers.length > 0;
}

type Config = ReturnType<typeof mailConfiguration>;

async function submit(row: IncidentMail, config: Config, admin: SupabaseClient): Promise<string | null> {
  const title = row.phase === 'resolved' ? 'WhatsApp reconectado' : row.reason === 'verification_unavailable'
    ? 'Verifique a conexão do WhatsApp' : 'Falha na conexão do WhatsApp';
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.occurred_at));
  const body = {
    to: [row.recipient_email], subject: `${title} · ${row.line_label.replace(/[\r\n]/g, ' ')}`,
    text: [title, `Número: ${row.line_label}`, `Horário de Brasília: ${time}`,
      'No CRM, abra WhatsApp > Conexão para consultar o estado deste número.'].join('\n'),
  };
  if (row.mail_provider === 'hostinger') {
    const host = config.hostinger;
    if (!host) throw new Error('Provedor da reserva indisponível');
    // The API has no idempotency key. Persist the attempt before making any network request.
    const begun = await admin.rpc('wa_begin_hostinger_connection_email', { p_id: row.id, p_lease_token: row.lease_token });
    if (begun.error) throw new Error('Falha ao registrar a tentativa de envio', { cause: begun.error });
    if (begun.data !== true) return 'email_lease_unavailable';
    try {
      const res = await fetch(`https://api.mail.hostinger.com/api/v1/mailboxes/${encodeURIComponent(host.mailbox)}/send`, {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, displayName: host.displayName }), signal: AbortSignal.timeout(6500),
      });
      if (res.status === 204) return null;
      if ([401, 403, 422, 429].includes(res.status)) return `hostinger_http_${res.status}`;
    } catch { /* The provider may already have accepted the message. */ }
    return 'hostinger_unconfirmed';
  }
  if (row.mail_provider !== 'resend' || !config.resend) throw new Error('Provedor da reserva indisponível');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${config.resend.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `wa-connection/${row.id}` },
      body: JSON.stringify({ from: config.resend.from, ...body }), signal: AbortSignal.timeout(6500),
    });
    return res.ok ? null : `email_http_${res.status}`;
  } catch {
    return 'email_transport_unconfirmed';
  }
}

export async function dispatchConnectionIncidentEmails(admin: SupabaseClient) {
  const config = mailConfiguration();
  if (!config.providers.length) return { configured: false, sent: 0, deferred: 0 };
  const { data, error } = await admin.rpc('wa_claim_connection_email_batch', {
    p_limit: 12, p_providers: config.providers, p_hostinger_start_at: config.hostinger?.startAt ?? null,
  });
  if (error) throw new Error('Falha ao reservar os avisos por e-mail', { cause: error });
  const rows: IncidentMail[] = data ?? [];
  let sent = 0;
  let deferred = 0;
  for (let start = 0; start < rows.length; start += 2) {
    await Promise.all(rows.slice(start, start + 2).map(async row => {
      const deliveryError = await submit(row, config, admin);
      if (deliveryError === 'email_lease_unavailable') { deferred++; return; }
      const finish = await admin.rpc('wa_finish_connection_email', {
        p_id: row.id, p_lease_token: row.lease_token, p_error: deliveryError,
      });
      if (finish.error) throw new Error('Falha ao gravar o resultado do aviso por e-mail', { cause: finish.error });
      if (deliveryError || finish.data !== true) deferred++;
      else sent++;
    }));
  }
  return { configured: true, sent, deferred };
}
