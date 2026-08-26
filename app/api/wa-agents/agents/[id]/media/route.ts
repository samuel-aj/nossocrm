/**
 * /api/wa-agents/agents/[id]/media  (admin + beta)
 *   GET  -> { media: AgentMediaRow[] } (ordem de cadastro)
 *   POST -> AgentMediaInputSchema { name, description, kind, storage_path, mime, size_bytes }
 *           (storage_path em ${orgId}/agents/${id}/media/; nome único por agente;
 *           mime coerente com a categoria) -> 201 { media }
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { isAgentFilePath } from '@/lib/wa-agents/files';
import { loadAgentMedia, MEDIA_COLUMNS } from '@/lib/wa-agents/resources';
import { AgentMediaInputSchema, type AgentMediaRow } from '@/lib/wa-agents/types';
import {
  agentBelongsToOrg,
  agentNotFoundError,
  getErrorMessage,
  guardRoute,
  mediaMimeMatchesKind,
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
  if (!mediaMimeMatchesKind(input.kind, input.mime)) {
    return validationMessage('O tipo do arquivo não combina com a categoria escolhida', 'mime');
  }

  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, id))) return agentNotFoundError();
    const existing = await loadAgentMedia(auth.admin, orgId, id);
    if (mediaNameTaken(existing, name)) {
      return validationMessage('Já existe uma mídia com este nome neste agente', 'name');
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
      mime: input.mime.trim() || null,
      size_bytes: input.size_bytes,
      storage_path: input.storage_path,
    })
    .select(MEDIA_COLUMNS)
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ media: data as AgentMediaRow }, 201);
}
