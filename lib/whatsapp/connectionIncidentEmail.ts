import type { SupabaseClient } from '@supabase/supabase-js';

interface IncidentMail {
  id: string;
  lease_token: string;
  phase: 'opened' | 'resolved';
  recipient_email: string;
  line_label: string;
  reason: string;
  occurred_at: string;
}

export async function dispatchConnectionIncidentEmails(admin: SupabaseClient) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.WA_CONNECTION_ALERT_EMAIL_FROM?.trim();
  // Preserve pending notices until a verified sender and a credential are configured.
  if (!key || !from) return { configured: false, sent: 0, deferred: 0 };
  const { data, error } = await admin.rpc('wa_claim_connection_emails', { p_limit: 12 });
  if (error) throw new Error('Falha ao reservar os avisos por e-mail', { cause: error });
  const rows: IncidentMail[] = data ?? [];
  let sent = 0;
  let deferred = 0;
  // Small batches keep concurrent requests bounded and stay inside the claim lease.
  for (let start = 0; start < rows.length; start += 2) {
    await Promise.all(rows.slice(start, start + 2).map(async row => {
      const recovered = row.phase === 'resolved';
      const uncertain = row.reason === 'verification_unavailable';
      const title = recovered ? 'WhatsApp reconectado' : uncertain ? 'Verifique a conexão do WhatsApp' : 'Falha na conexão do WhatsApp';
      const time = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.occurred_at));
      const text = [
        title, `Número: ${row.line_label}`, `Horário de Brasília: ${time}`,
        'No CRM, abra WhatsApp > Conexão para consultar o estado deste número.',
      ].join('\n');
      let deliveryError: string | null = null;
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `wa-connection/${row.id}` },
          body: JSON.stringify({ from, to: [row.recipient_email], subject: `${title} · ${row.line_label.replace(/[\r\n]/g,' ')}`, text }),
          signal: AbortSignal.timeout(6500),
        });
        if (!res.ok) deliveryError = `email_http_${res.status}`;
      } catch {
        deliveryError = 'email_transport_unconfirmed';
      }
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
