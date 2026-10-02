import { z } from 'zod';
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getGroupLinks } from '@/lib/whatsapp/group-links/reads';
import { mutateGroupLink } from '@/lib/whatsapp/group-links/service';
import { groupLinksErrorResponse, type GroupLinksTarget } from '@/lib/whatsapp/group-links/types';

export const dynamic = 'force-dynamic';
const mutation = z.object({ conversationId: z.uuid(), entityType: z.enum(['contact', 'deal']), entityId: z.uuid(), action: z.enum(['link', 'unlink', 'set_primary']) }).strict();
export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const params = new URL(req.url).searchParams;
  const keys = ['conversationId', 'contactId', 'dealId'] as const;
  const supplied = keys.filter(key => params.has(key));
  if (supplied.length !== 1 || params.getAll(supplied[0]).length !== 1 || !z.uuid().safeParse(params.get(supplied[0])).success) return json({ error: 'Informe uma conversa, contato ou lead válido.' }, 400);
  const target = { [supplied[0]]: params.get(supplied[0]) } as GroupLinksTarget;
  try { return json(await getGroupLinks(auth.admin, auth.user, target)); }
  catch (error) { return groupLinksErrorResponse(error); }
}
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida.' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const parsed = mutation.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (parsed.data.entityType === 'contact' && parsed.data.action === 'set_primary')) return json({ error: 'Alteração de vínculo inválida.' }, 400);
  try { await mutateGroupLink(auth.admin, auth.user, parsed.data); return json({ ok: true }); }
  catch (error) { return groupLinksErrorResponse(error); }
}
