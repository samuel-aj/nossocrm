/**
 * /api/wa-agents/agents/[id]/knowledge-gaps  (admin + beta)
 *   GET ?status=open|included|ignored -> { gaps, counts, learned_by_document }
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { listKnowledgeGaps } from '@/lib/wa-agents/knowledgeGaps';
import { KNOWLEDGE_GAP_STATUSES, type KnowledgeGapStatus } from '@/lib/wa-agents/knowledgeGapsShared';
import { agentBelongsToOrg, agentNotFoundError, getErrorMessage, guardRoute } from '../../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ admin: true, agents: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const status = new URL(req.url).searchParams.get('status') ?? 'open';
  if (!(KNOWLEDGE_GAP_STATUSES as readonly string[]).includes(status)) return json({ error: 'Status inválido' }, 400);
  const orgId = auth.user.organizationId;
  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    return json(await listKnowledgeGaps(auth.admin, orgId, id, status as KnowledgeGapStatus));
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao listar as dúvidas') }, 500);
  }
}
