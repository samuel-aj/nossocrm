import { checkConversationBudget } from '@/lib/ai-usage/budget';
import { readUsageAccountLinks, usageAccountRoots } from '@/lib/ai-usage/reporting';
import { json } from '@/lib/whatsapp/api';
import { ConversationId, conversationUsageAccess, guardRoute, usageError } from '../../_shared';
export const runtime = 'nodejs';
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guardRoute(); if (!auth.ok) return auth.response;
  const id = ConversationId.safeParse((await ctx.params).id); if (!id.success) return json({ error: 'Conversa inválida' }, 400);
  try {
    const access = await conversationUsageAccess(auth.admin, auth.user, id.data);
    if (!access.allowed) return json({ error: 'Conversa indisponível' }, 404);
    const budget = await checkConversationBudget(auth.admin, auth.user.organizationId, id.data);
    const roots = budget.account_id ? usageAccountRoots(await readUsageAccountLinks(auth.admin, auth.user.organizationId)) : new Map<string, string>();
    const accountIds = [...roots].filter(([, root]) => root === budget.account_id).map(([id]) => id);
    const grants = accountIds.length ? await auth.admin.from('ai_usage_grants').select('id,actor_id,reason,tokens,seconds,created_at').eq('organization_id', auth.user.organizationId).in('account_id', accountIds).order('created_at', { ascending: false }).limit(20) : { data: [], error: null };
    if (grants.error) return usageError();
    return json({ budget, canGrant: access.canGrant, grants: grants.data ?? [] });
  } catch { return usageError(); }
}
