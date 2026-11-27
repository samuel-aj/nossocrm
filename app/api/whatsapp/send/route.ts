import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { enforceRateLimit, LIMITS } from '@/lib/security/rateLimit';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { sendMessage } from '@/lib/whatsapp/sendMessage';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const limited = await enforceRateLimit({ scope: 'whatsapp_send', id: auth.user.id, limit: LIMITS.whatsappSendPerUser(), request: req, actorId: auth.user.id, organizationId: auth.user.organizationId });
  if (limited) return limited;
  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }
  return sendMessage(auth, body);
}
