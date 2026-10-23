import { grantConversationBudget } from '@/lib/ai-usage/budget';
import { json } from '@/lib/whatsapp/api';
import { ConversationId, GrantBody, conversationUsageAccess, guardRoute, readJsonBody, usageError, validationError } from '../../../_shared';
export const runtime = 'nodejs';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guardRoute({ req }); if (!auth.ok) return auth.response;
  const id = ConversationId.safeParse((await ctx.params).id); if (!id.success) return json({ error: 'Conversa inválida' }, 400);
  const body = GrantBody.safeParse(await readJsonBody(req)); if (!body.success) return validationError(body.error);
  try {
    const access = await conversationUsageAccess(auth.admin, auth.user, id.data);
    if (!access.allowed) return json({ error: 'Conversa indisponível' }, 404);
    if (!access.canGrant) return json({ error: 'Somente o responsável pelo atendimento ou um administrador pode liberar quota', code: 'FORBIDDEN' }, 403);
    const budget = await grantConversationBudget(auth.admin, { organizationId: auth.user.organizationId, conversationId: id.data, actorId: auth.user.id, ...body.data });
    // A quota does not enqueue a response or send a message to the contact.
    return json({ budget });
  } catch { return usageError(); }
}
