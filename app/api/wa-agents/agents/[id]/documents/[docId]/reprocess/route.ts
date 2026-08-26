/**
 * POST /api/wa-agents/agents/[id]/documents/[docId]/reprocess  (admin + beta)
 *
 * Reprocessa o documento (extração, trechos, embeddings): marca 'processing',
 * responde 202 { document } e processa em segundo plano depois da resposta.
 * Documento ainda em processamento (recente) responde 409: dois processamentos
 * ao mesmo tempo duplicariam os trechos. Um 'processing' antigo (função
 * interrompida) pode ser reprocessado.
 */
import { after } from 'next/server';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { DOCUMENT_COLUMNS, loadDocument, processDocument, PROCESSING_STALE_MS } from '@/lib/wa-agents/knowledge';
import type { AgentDocumentRow } from '@/lib/wa-agents/types';
import { guardRoute } from '../../../../../_shared';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string; docId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const { id, docId } = await ctx.params;
  if (!isValidUUID(id) || !isValidUUID(docId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;

  // loadDocument já converte 'processing' antigo em erro reprocessável
  const existing = await loadDocument(auth.admin, orgId, docId);
  if (!existing || existing.agent_id !== id) return json({ error: 'Documento não encontrado' }, 404);

  // Reserva atômica: só muda a linha se ela não estiver em processamento recente
  const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS).toISOString();
  let claim = auth.admin
    .from('wa_ai_agent_documents')
    .update({ status: 'processing', error: null, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('id', existing.id);
  claim = existing.status === 'processing' ? claim.eq('status', 'processing').lt('updated_at', staleBefore) : claim.neq('status', 'processing');
  const { data, error } = await claim.select(DOCUMENT_COLUMNS).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) {
    return json({ error: 'O documento ainda está sendo processado. Aguarde terminar antes de reprocessar.', code: 'PROCESSING' }, 409);
  }
  const document = data as AgentDocumentRow;

  after(async () => {
    try {
      await processDocument(auth.admin, { organizationId: orgId, documentId: document.id });
    } catch (err) {
      console.error('[wa-agents/documents/reprocess] falha ao processar documento', err);
    }
  });

  return json({ document }, 202);
}
