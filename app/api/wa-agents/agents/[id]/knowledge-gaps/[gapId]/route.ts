/**
 * /api/wa-agents/agents/[id]/knowledge-gaps/[gapId]  (admin + beta)
 *   PATCH  -> { gap }  KnowledgeGapActionSchema: include | edit (com document_id ou
 *            create_document) | remove | ignore | reopen
 *   DELETE -> { ok: true }  só dúvida aberta ou ignorada
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { applyKnowledgeGapAction, deleteKnowledgeGap, KnowledgeGapError } from '@/lib/wa-agents/knowledgeGaps';
import { KnowledgeGapActionSchema } from '@/lib/wa-agents/knowledgeGapsShared';
import { agentBelongsToOrg, agentNotFoundError, getErrorMessage, guardRoute, readJsonBody, validationError } from '../../../../_shared';

export const runtime = 'nodejs';
/** Criar o documento "Respostas aprendidas" processa o arquivo na mesma chamada. */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string; gapId: string }> };

function failure(err: unknown, fallback: string): Response {
  if (err instanceof KnowledgeGapError) return json({ error: err.message, code: err.code }, err.status);
  return json({ error: getErrorMessage(err, fallback) }, 500);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true, agents: true });
  if (!auth.ok) return auth.response;
  const { id, gapId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(gapId)) return json({ error: 'ID inválido' }, 400);
  const parsed = KnowledgeGapActionSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const orgId = auth.user.organizationId;
  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    const gap = await applyKnowledgeGapAction(auth.admin, {
      organizationId: orgId,
      agentId: id,
      gapId,
      userId: auth.user.id,
      action: parsed.data,
    });
    return json({ gap });
  } catch (err) {
    return failure(err, 'Falha ao atualizar a dúvida');
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true, agents: true });
  if (!auth.ok) return auth.response;
  const { id, gapId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(gapId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;
  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    await deleteKnowledgeGap(auth.admin, { organizationId: orgId, agentId: id, gapId });
    return json({ ok: true });
  } catch (err) {
    return failure(err, 'Falha ao excluir a dúvida');
  }
}
