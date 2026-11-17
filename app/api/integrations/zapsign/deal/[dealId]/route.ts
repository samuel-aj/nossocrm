/**
 * /api/integrations/zapsign/deal/[dealId]  (membro que enxerga o lead)
 *   GET   -> { connected, sandbox, signatures: [...], file_url, file_signature_id }
 *            documentos deste lead (o mais recente primeiro), inclusive os que
 *            estão aguardando conferência, e o link temporário do PDF assinado.
 *   PATCH -> { signature_id, action: 'discard' }  descarta um contrato que
 *            ainda estava aguardando conferência (nada foi criado na ZapSign).
 */
import { z } from 'zod';
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import { createClient } from '@/lib/supabase/server';
import { guardRoute, readJsonBody, validationError, getErrorMessage } from '@/app/api/wa-agents/_shared';
import { DEAL_FILES_BUCKET, discardSignature, loadZapSignSettings, recoverManualPackage, type SignatureRow } from '@/lib/zapsign/signatures';
import { getTeamAccess, visibleLead } from '@/lib/permissions/teamAccessServer';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ dealId: string }> };

async function visibleDeal(dealId: string, orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('deals').select('id,board_id,owner_id').eq('id', dealId).eq('organization_id', orgId).is('deleted_at',null).maybeSingle();
  return data;
}

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;
  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;
  if (!(await visibleDeal(dealId, orgId))) return json({ error: 'Lead não encontrado' }, 404);

  const [settings, { data, error }] = await Promise.all([
    loadZapSignSettings(auth.admin, orgId),
    auth.admin
      .from('deal_signatures')
      .select('id, origin, status, stage_id, template_name, doc_name, doc_token, sign_url, sent_via, sent_at, signed_at, refused_at, refused_reason, file_id, file_path, last_error, signers, created_at, package_unverified:request->package_unverified, package_recovered:request->package_recovered, notices:zapsign_agent_notices(kind,state,note)')
      .eq('organization_id', orgId)
      .eq('deal_id', dealId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  if (error) {
    if (/deal_signatures/.test(error.message)) return json({ connected: false, signatures: [], pendingMigration: true });
    return json({ error: error.message }, 500);
  }
  const list = (data ?? []) as Array<Partial<SignatureRow> & { id: string; package_unverified?: boolean; package_recovered?: boolean }>;
  const withFile = list.find((s) => s.file_path);
  let fileUrl: string | null = null;
  if (withFile?.file_path) {
    const { data: signed } = await auth.admin.storage.from(DEAL_FILES_BUCKET).createSignedUrl(withFile.file_path, 3600);
    fileUrl = signed?.signedUrl ?? null;
  }
  return json({
    connected: !!settings,
    sandbox: settings?.sandbox ?? false,
    signatures: list.map((s) => ({
      ...s,
      can_recover: s.origin !== 'agent' && ((s.status === 'pending' && !!s.package_recovered) ||
        (s.status === 'failed' && (!!s.package_unverified || /pacote completo/i.test(s.last_error || '')))),
      signers: (s.signers ?? []).map((x) => ({ name: x.name, status: x.status, signed_at: x.signed_at, role: x.role })),
    })),
    file_url: fileUrl,
    file_signature_id: withFile?.id ?? null,
  });
}

const Patch = z.object({ signature_id: z.string().uuid(), action: z.enum(['discard','recover']), provider_token:z.string().uuid().optional() });

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req });
  if (!auth.ok) return auth.response;
  const { dealId } = await ctx.params;
  if (!isValidUUID(dealId)) return json({ error: 'ID inválido' }, 400);
  const orgId = auth.user.organizationId;
  const parsed = Patch.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const deal = await visibleDeal(dealId, orgId);
  if (!deal) return json({ error: 'Lead não encontrado' }, 404);
  try {
    if (parsed.data.action === 'recover') {
      const access = await getTeamAccess(auth.admin, orgId, auth.user.id);
      if (!access.fullAccess && !(access.boards.some(b=>b.boardId === deal.board_id && b.edit) && visibleLead(access,auth.user.id,deal.board_id,deal.owner_id)))
        return json({ error: 'Sem permissão para editar este lead.' }, 403);
      try {
        return json({ signature: await recoverManualPackage(auth.admin, {organizationId:orgId,dealId,signatureId:parsed.data.signature_id,userId:auth.user.id,providerToken:parsed.data.provider_token}) });
      } catch (err) {
        return json({ error: getErrorMessage(err, 'Falha ao conferir o envelope') }, 409);
      }
    }
    const row = await discardSignature(auth.admin, { organizationId: orgId, dealId, signatureId: parsed.data.signature_id, userId: auth.user.id });
    if (!row) return json({ error: 'Este contrato não está mais aguardando conferência.' }, 409);
    return json({ signature: { id: row.id, status: row.status } });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao descartar') }, 500);
  }
}
