/**
 * /api/wa-agents/agents/[id]/documents/[docId]  (admin + beta)
 *   GET    -> { document }   (status atual; útil para polling de um único documento)
 *   PATCH  -> { document }   metadados (title, description, tags); reprocessar depois para revetorizar
 *   DELETE -> { ok: true }   apaga os trechos, a linha e o arquivo do bucket
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { DOCUMENT_COLUMNS, deleteDocumentChunks, loadDocument } from '@/lib/wa-agents/knowledge';
import { AgentDocumentMetaSchema, type AgentDocumentRow } from '@/lib/wa-agents/types';
import { getErrorMessage, guardRoute, readJsonBody, removeAgentFiles, validationError } from '../../../../_shared';

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

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const { id, docId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(docId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const parsed = AgentDocumentMetaSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const meta = parsed.data;

  const document = await loadDocument(auth.admin, orgId, docId);
  if (!document || document.agent_id !== id) return json({ error: 'Documento não encontrado' }, 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (meta.title !== undefined) patch.title = meta.title?.trim() || null;
  if (meta.description !== undefined) patch.description = meta.description?.trim() || null;
  if (meta.tags !== undefined) patch.tags = meta.tags.map(t => t.trim()).filter(Boolean);

  const { data, error } = await auth.admin
    .from('wa_ai_agent_documents')
    .update(patch)
    .eq('organization_id', orgId)
    .eq('id', document.id)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();
  if (error) {
    const missing = /column .*(title|description|tags).* does not exist/i.test(error.message);
    return json(
      { error: missing ? 'Metadados de documento precisam da migração 20260827120000_wa_ai_agent_documents_metadata (rode no Supabase).' : error.message },
      missing ? 409 : 500
    );
  }
  if (!data) return json({ error: 'Documento não encontrado' }, 404);
  return json({ document: data as AgentDocumentRow });
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
