/**
 * /api/wa-agents/agents/[id]/documents  (admin + beta)
 *   GET  -> { documents: AgentDocumentRow[] } (mais recentes primeiro)
 *   POST -> AgentDocumentInputSchema { name, storage_path, mime, size_bytes }
 *           (storage_path precisa estar em ${orgId}/agents/${id}/docs/; tipo PDF,
 *           DOCX, TXT ou MD) -> 201 { document } com status 'processing' e processa
 *           em segundo plano depois de responder (extração, trechos, embeddings).
 *           A UI faz polling do GET enquanto houver documento 'processing'.
 */
import { after } from 'next/server';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { isAgentFilePath } from '@/lib/wa-agents/files';
import { DOCUMENT_COLUMNS, loadAgentDocuments, processDocument, resolveDocumentMime } from '@/lib/wa-agents/knowledge';
import { AgentDocumentInputSchema, type AgentDocumentRow } from '@/lib/wa-agents/types';
import {
  agentBelongsToOrg,
  agentNotFoundError,
  getErrorMessage,
  guardRoute,
  readJsonBody,
  validationError,
  validationMessage,
} from '../../../_shared';

export const runtime = 'nodejs';
/** Processamento do documento roda depois da resposta (after) e pode demorar */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    const documents = await loadAgentDocuments(auth.admin, orgId, id);
    return json({ documents });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao listar os documentos') }, 500);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const parsed = AgentDocumentInputSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;

  if (!isAgentFilePath(input.storage_path, orgId, id, 'doc')) {
    return validationMessage('Caminho do arquivo inválido para este agente', 'storage_path');
  }
  const mime = resolveDocumentMime(input.mime, input.name);
  if (!mime) return validationMessage('Tipo de arquivo não suportado (use PDF, DOCX, TXT ou MD)', 'mime');

  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar o agente') }, 500);
  }

  const { data, error } = await auth.admin
    .from('wa_ai_agent_documents')
    .insert({
      organization_id: orgId,
      agent_id: id,
      name: input.name.trim(),
      mime,
      size_bytes: input.size_bytes,
      storage_path: input.storage_path,
      status: 'processing',
      error: null,
      chunk_count: 0,
      created_by: auth.user.id,
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error) return json({ error: error.message }, 500);
  const document = data as AgentDocumentRow;

  after(async () => {
    try {
      await processDocument(auth.admin, { organizationId: orgId, documentId: document.id });
    } catch (err) {
      console.error('[wa-agents/documents] falha ao processar documento', err);
    }
  });

  return json({ document }, 201);
}
