/**
 * /api/wa-agents/agents/[id]/media/[mediaId]  (admin + beta)
 *   PATCH  -> { media }     { name?, description? } (nome único por agente)
 *   DELETE -> { ok: true }  apaga a linha e o arquivo do bucket
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { loadAgentMedia, MEDIA_COLUMNS } from '@/lib/wa-agents/resources';
import { AgentMediaPatchSchema, type AgentMediaRow } from '@/lib/wa-agents/types';
import {
  getErrorMessage,
  guardRoute,
  mediaNameTaken,
  pickPresentKeys,
  readJsonBody,
  removeAgentFiles,
  validationError,
  validationMessage,
} from '../../../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const { id, mediaId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(mediaId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const raw = await readJsonBody(req);
  const parsed = AgentMediaPatchSchema.safeParse(raw);
  if (!parsed.success) return validationError(parsed.error);
  const present = pickPresentKeys(raw, parsed.data);

  const patch: Record<string, unknown> = {};
  try {
    const all = await loadAgentMedia(auth.admin, orgId, id);
    const current = all.find(m => m.id === mediaId);
    if (!current) return json({ error: 'Mídia não encontrada' }, 404);
    if (typeof present.name === 'string') {
      const name = present.name.trim();
      if (!name) return validationMessage('Informe o nome da mídia', 'name');
      if (mediaNameTaken(all, name, current.id)) {
        return validationMessage('Já existe uma mídia com este nome neste agente', 'name');
      }
      patch.name = name;
    }
    if (typeof present.description === 'string') patch.description = present.description.trim() || null;
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar a mídia') }, 500);
  }
  if (Object.keys(patch).length === 0) {
    const all = await loadAgentMedia(auth.admin, orgId, id);
    return json({ media: all.find(m => m.id === mediaId) ?? null });
  }

  const { data, error } = await auth.admin
    .from('wa_ai_agent_media')
    .update(patch)
    .eq('organization_id', orgId)
    .eq('agent_id', id)
    .eq('id', mediaId)
    .select(MEDIA_COLUMNS)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Mídia não encontrada' }, 404);
  return json({ media: data as AgentMediaRow });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const { id, mediaId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(mediaId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  const { data: existing, error: findError } = await auth.admin
    .from('wa_ai_agent_media')
    .select(MEDIA_COLUMNS)
    .eq('organization_id', orgId)
    .eq('agent_id', id)
    .eq('id', mediaId)
    .maybeSingle();
  if (findError) return json({ error: findError.message }, 500);
  if (!existing) return json({ error: 'Mídia não encontrada' }, 404);
  const media = existing as AgentMediaRow;

  const { error } = await auth.admin
    .from('wa_ai_agent_media')
    .delete()
    .eq('organization_id', orgId)
    .eq('id', media.id);
  if (error) return json({ error: error.message }, 500);

  if (media.storage_path.startsWith(`${orgId}/`)) await removeAgentFiles(auth.admin, [media.storage_path]);

  return json({ ok: true });
}
