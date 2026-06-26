/**
 * POST /api/whatsapp/send -> envia uma mensagem de texto e persiste (out).
 * Body: { to: string (telefone), text: string }
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getConnectionByOrg, ensureConversation, recordOutboundMessage } from '@/lib/whatsapp/service';
import { getProvider } from '@/lib/whatsapp';
import { normalizePhoneE164 } from '@/lib/phone';

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  let body: { to?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const to = normalizePhoneE164(body.to || '');
  const text = (body.text || '').trim();
  if (!to || !text) return json({ error: 'to e text são obrigatórios' }, 400);

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn) return json({ error: 'Conexão de WhatsApp não configurada' }, 400);

  const conv = await ensureConversation(auth.admin, auth.user.organizationId, conn.id, to);
  const result = await getProvider(conn).sendText({ to, text });

  const message = await recordOutboundMessage(auth.admin, {
    orgId: auth.user.organizationId,
    conversationId: conv.id,
    text,
    providerMessageId: result.providerMessageId,
    fromPhone: conn.phone_number,
    toPhone: to,
    sentBy: auth.user.id,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
  });

  if (!result.ok) {
    return json({ ok: false, error: result.error || 'Falha no envio', message }, 502);
  }
  return json({ ok: true, message });
}
