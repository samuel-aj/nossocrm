/**
 * POST /api/wa-agents/uploads  (admin + beta)
 * body { agentId: uuid, fileName: string, kind: 'doc'|'media' }
 *
 * URL assinada de upload no bucket privado wa-agent-files. O arquivo NÃO
 * passa pela Vercel: o client recebe { path, token } e sobe direto com
 * `supabase.storage.from('wa-agent-files').uploadToSignedUrl(path, token, file)`;
 * depois registra em /agents/[id]/documents ou /agents/[id]/media com o `path`.
 * Caminho: ${orgId}/agents/${agentId}/docs|media/<uuid>_<nome>
 */
import { randomUUID } from 'crypto';
import { json } from '@/lib/whatsapp/api';
import { agentFilePath } from '@/lib/wa-agents/files';
import { AgentUploadInputSchema, WA_AGENT_FILES_BUCKET } from '@/lib/wa-agents/types';
import {
  agentBelongsToOrg,
  agentNotFoundError,
  getErrorMessage,
  guardRoute,
  readJsonBody,
  validationError,
} from '../_shared';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const parsed = AgentUploadInputSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const { agentId, fileName, kind } = parsed.data;

  try {
    if (!(await agentBelongsToOrg(auth.admin, orgId, agentId))) return agentNotFoundError();
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar o agente') }, 500);
  }

  const path = agentFilePath(orgId, agentId, kind, fileName, randomUUID());
  const { data, error } = await auth.admin.storage.from(WA_AGENT_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return json({ error: `Falha ao preparar upload: ${error?.message ?? 'desconhecida'}` }, 500);
  }
  return json({ path: data.path, token: data.token });
}
