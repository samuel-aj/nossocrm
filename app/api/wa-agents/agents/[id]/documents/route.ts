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
import { getAgentFileInfo } from '@/lib/wa-agents/storage';
import {
  AGENT_DOC_MAX_BYTES,
  AGENT_DOCS_MAX_PER_AGENT,
  AgentDocumentInputSchema,
  type AgentDocumentRow,
} from '@/lib/wa-agents/types';
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

/** Coluna de metadado ausente = migração 20260827120000 não aplicada: mensagem clara. */
function metadataColumnHint(message: string): string {
  return /column .*(title|description|tags).* does not exist/i.test(message)
    ? 'Metadados de documento precisam da migração 20260827120000_wa_ai_agent_documents_metadata (rode no Supabase).'
    : message;
}
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

  let sizeBytes = input.size_bytes;
  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();

    // Teto de documentos por agente
    const { count, error: countError } = await auth.admin
      .from('wa_ai_agent_documents')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('agent_id', id);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= AGENT_DOCS_MAX_PER_AGENT) {
      return validationMessage(`Limite de ${AGENT_DOCS_MAX_PER_AGENT} documentos por agente. Exclua um documento antes de enviar outro.`, 'name');
    }

    // Tamanho real do objeto no Storage (o valor do corpo não é confiável)
    const info = await getAgentFileInfo(auth.admin, input.storage_path);
    if (!info) return validationMessage('Arquivo não encontrado no armazenamento. Envie o arquivo de novo.', 'storage_path');
    if (typeof info.size === 'number') {
      if (info.size > AGENT_DOC_MAX_BYTES) {
        return validationMessage(`Arquivo maior que o limite de ${Math.round(AGENT_DOC_MAX_BYTES / 1024 / 1024)} MB`, 'size_bytes');
      }
      sizeBytes = info.size;
    }
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
      size_bytes: sizeBytes,
      storage_path: input.storage_path,
      status: 'processing',
      error: null,
      chunk_count: 0,
      created_by: auth.user.id,
      // metadados só quando informados (antes da migração 20260827120000 as colunas não existem)
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error) return json({ error: metadataColumnHint(error.message) }, 500);
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
