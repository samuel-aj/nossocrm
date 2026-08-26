/**
 * /api/wa-agents/agents/[id]/media  (admin + beta)
 *   GET  -> { media: AgentMediaRow[] } (ordem de cadastro)
 *   POST -> AgentMediaInputSchema { name, description, kind, storage_path, mime, size_bytes }
 *           (storage_path em ${orgId}/agents/${id}/media/; nome único por agente;
 *           mime numa lista fechada por categoria; tipo e tamanho conferidos no
 *           objeto do Storage, que prevalece sobre o corpo) -> 201 { media }
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { isAgentFilePath } from '@/lib/wa-agents/files';
import { loadAgentMedia, MEDIA_COLUMNS } from '@/lib/wa-agents/resources';
import { getAgentFileInfo, isGenericMime } from '@/lib/wa-agents/storage';
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_MEDIA_MIMES,
  AgentMediaInputSchema,
  isAllowedMediaMime,
  normalizeMime,
  type AgentMediaRow,
} from '@/lib/wa-agents/types';
import {
  agentBelongsToOrg,
  agentNotFoundError,
  getErrorMessage,
  guardRoute,
  mediaNameTaken,
  readJsonBody,
  validationError,
  validationMessage,
} from '../../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    const media = await loadAgentMedia(auth.admin, orgId, id);
    return json({ media });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao listar as mídias') }, 500);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const parsed = AgentMediaInputSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;
  const name = input.name.trim();
  if (!name) return validationMessage('Informe o nome da mídia', 'name');

  if (!isAgentFilePath(input.storage_path, orgId, id, 'media')) {
    return validationMessage('Caminho do arquivo inválido para este agente', 'storage_path');
  }
  const bodyMime = normalizeMime(input.mime);
  if (!isAllowedMediaMime(input.kind, bodyMime)) {
    return validationMessage(`Tipo de arquivo não aceito para esta categoria. Aceitos: ${AGENT_MEDIA_MIMES[input.kind].join(', ')}`, 'mime');
  }

  let mime = bodyMime;
  let sizeBytes = input.size_bytes;
  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    const existing = await loadAgentMedia(auth.admin, orgId, id);
    if (mediaNameTaken(existing, name)) {
      return validationMessage('Já existe uma mídia com este nome neste agente', 'name');
    }

    // O objeto no Storage manda: tipo e tamanho reais do arquivo enviado
    const info = await getAgentFileInfo(auth.admin, input.storage_path);
    if (!info) return validationMessage('Arquivo não encontrado no armazenamento. Envie o arquivo de novo.', 'storage_path');
    const storedMime = isGenericMime(info.mime) ? null : info.mime;
    if (storedMime) {
      if (storedMime !== bodyMime) {
        return validationMessage(`O tipo do arquivo enviado (${storedMime}) não combina com o informado (${bodyMime})`, 'mime');
      }
      if (!isAllowedMediaMime(input.kind, storedMime)) {
        return validationMessage('O tipo do arquivo enviado não é aceito para esta categoria', 'mime');
      }
      mime = storedMime;
    }
    if (typeof info.size === 'number') {
      if (info.size > AGENT_FILE_MAX_BYTES) return validationMessage('Arquivo maior que o limite de 50 MB', 'size_bytes');
      if (info.size !== input.size_bytes) {
        return validationMessage('O tamanho do arquivo enviado não combina com o informado', 'size_bytes');
      }
      sizeBytes = info.size;
    }
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar a mídia') }, 500);
  }

  const { data, error } = await auth.admin
    .from('wa_ai_agent_media')
    .insert({
      organization_id: orgId,
      agent_id: id,
      name,
      description: input.description.trim() || null,
      kind: input.kind,
      mime,
      size_bytes: sizeBytes,
      storage_path: input.storage_path,
    })
    .select(MEDIA_COLUMNS)
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ media: data as AgentMediaRow }, 201);
}
