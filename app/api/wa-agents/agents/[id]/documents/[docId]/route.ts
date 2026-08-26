/**
 * /api/wa-agents/agents/[id]/documents/[docId]  (admin + beta)
 *   GET    -> { document }   (status atual; útil para polling de um único documento)
 *   DELETE -> { ok: true }   apaga os trechos, a linha e o arquivo do bucket
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { deleteDocumentChunks, loadDocument } from '@/lib/wa-agents/knowledge';
import { getErrorMessage, guardRoute, removeAgentFiles } from '../../../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; docId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const { id, docId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(docId)) return json({ error: 'ID inválido' }, 400);

  const document = await loadDocument(auth.admin, auth.user.organizationId, docId);
  if (!document || document.agent_id !== id) return json({ error: 'Documento não encontrado' }, 404);
  return json({ document });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const { id, docId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(docId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const document = await loadDocument(auth.admin, orgId, docId);
  if (!document || document.agent_id !== id) return json({ error: 'Documento não encontrado' }, 404);

  try {
    await deleteDocumentChunks(auth.admin, orgId, document.id);
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao apagar os trechos do documento') }, 500);
  }
  const { error } = await auth.admin
    .from('wa_ai_agent_documents')
    .delete()
    .eq('organization_id', orgId)
    .eq('id', document.id);
  if (error) return json({ error: error.message }, 500);

  if (document.storage_path.startsWith(`${orgId}/`)) await removeAgentFiles(auth.admin, [document.storage_path]);

  return json({ ok: true });
}
