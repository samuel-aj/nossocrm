import { z } from 'zod';
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getGroupLinksEnabled, setGroupLinksEnabled } from '@/lib/whatsapp/group-links/settings';
import { groupLinksErrorResponse } from '@/lib/whatsapp/group-links/types';

export const dynamic = 'force-dynamic';
export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  try { return json({ enabled: await getGroupLinksEnabled(auth.admin, auth.user.organizationId) }); }
  catch (error) { return groupLinksErrorResponse(error); }
}
export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida.' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Somente administradores podem alterar este recurso.' }, 403);
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Configuração inválida.' }, 400);
  try {
    await setGroupLinksEnabled(auth.admin, auth.user.organizationId, parsed.data.enabled);
    return json({ enabled: parsed.data.enabled });
  } catch (error) { return groupLinksErrorResponse(error); }
}
