/**
 * GET /api/wa-agents/agents/[id]/documents/[docId]/file  (admin + beta)
 *
 * Link temporário para ABRIR o arquivo original do documento da base de
 * conhecimento (o bucket wa-agent-files é privado). O CRM não guarda cópia
 * pública: a tela troca o id por uma URL assinada de 10 minutos e abre numa
 * aba nova.
 *
 * -> { url, name, mime, expires_in }
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { loadDocument } from '@/lib/wa-agents/knowledge';
import { WA_AGENT_FILES_BUCKET } from '@/lib/wa-agents/types';
import { guardRoute } from '../../../../../_shared';

export const runtime = 'nodejs';

/** Validade do link: o suficiente para abrir e ler, sem virar link público. */
const EXPIRES = 600;

type Ctx = { params: Promise<{ id: string; docId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true, agents: true });
  if (!auth.ok) return auth.response;
  const { id, docId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(docId)) return json({ error: 'ID inválido' }, 400);

  const doc = await loadDocument(auth.admin, auth.user.organizationId, docId);
  if (!doc || doc.agent_id !== id) return json({ error: 'Documento não encontrado' }, 404);
  if (!doc.storage_path) return json({ error: 'Este documento não tem arquivo guardado' }, 404);

  const { data, error } = await auth.admin.storage
    .from(WA_AGENT_FILES_BUCKET)
    .createSignedUrl(doc.storage_path, EXPIRES, { download: false });
  if (error || !data?.signedUrl) {
    return json({ error: `Não foi possível abrir o arquivo: ${error?.message ?? 'desconhecido'}` }, 500);
  }

  return json({ url: data.signedUrl, name: doc.name, mime: doc.mime, expires_in: EXPIRES });
}
