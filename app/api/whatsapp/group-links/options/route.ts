import { z } from 'zod';
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { getGroupLinkOptions } from '@/lib/whatsapp/group-links/reads';
import { groupLinksErrorResponse } from '@/lib/whatsapp/group-links/types';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const params = new URL(req.url).searchParams;
  const parsed = z.object({ conversationId: z.uuid(), type: z.enum(['contact', 'deal']), q: z.string().max(200) }).safeParse({ conversationId: params.get('conversationId'), type: params.get('type'), q: params.get('q') ?? '' });
  if (!parsed.success || ['conversationId', 'type', 'q'].some(key => params.getAll(key).length > 1)) return json({ error: 'Busca de vínculos inválida.' }, 400);
  try { return json({ items: await getGroupLinkOptions(auth.admin, auth.user, parsed.data.conversationId, parsed.data.type, parsed.data.q.trim()) }); }
  catch (error) { return groupLinksErrorResponse(error); }
}
