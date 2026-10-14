import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { sendMessage } from '@/lib/whatsapp/sendMessage';

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }
  return sendMessage(auth, body);
}
