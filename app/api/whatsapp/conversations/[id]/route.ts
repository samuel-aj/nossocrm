import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { getTeamAccess, visibleLead } from '@/lib/permissions/teamAccessServer';
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isValidUUID } from '@/lib/supabase/utils';
import { conversationLabelsPatch, retryLabelWrite } from '@/lib/whatsapp/conversationLabels';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

/** Label deltas are atomic; the old labelIds replacement contract remains supported. */
export async function PATCH(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'Conversa inválida' }, 400);
  const orgId = auth.user.organizationId;
  if (!(await conversationAllowed(auth.admin, auth.user, { id }))) return json({ error: 'Conversa indisponível' }, 404);
  const parsed = conversationLabelsPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Alteração de etiquetas ou vínculo inválida' }, 400);
  const body = parsed.data;

  if ('dealId' in body && body.dealId) {
    const { data: conversation, error: convError } = await auth.admin.from('wa_conversations')
      .select('contact_id,is_group').eq('organization_id', orgId).eq('id', id).maybeSingle();
    if (convError) return json({ error: convError.message }, 500);
    if (!conversation || conversation.is_group) return json({ error: 'Grupos não podem ter lead vinculado' }, 400);
    const { data: deal, error: dealError } = await auth.admin.from('deals')
      .select('id,contact_id,board_id,owner_id').eq('organization_id', orgId).eq('id', body.dealId).is('deleted_at', null).maybeSingle();
    if (dealError) return json({ error: dealError.message }, 500);
    if (!deal || !conversation.contact_id || deal.contact_id !== conversation.contact_id) return json({ error: 'Lead indisponível para esta conversa' }, 404);
    const access = await getTeamAccess(auth.admin, orgId, auth.user.id);
    if (!visibleLead(access, auth.user.id, deal.board_id, deal.owner_id)) return json({ error: 'Lead indisponível para esta conversa' }, 404);
  }

  const requested = 'labelIds' in body ? body.labelIds : 'addLabelIds' in body ? [...body.addLabelIds, ...body.removeLabelIds] : [];
  if (requested.length) {
    const unique = [...new Set(requested)];
    const { data, error } = await auth.admin.from('wa_labels').select('id').eq('organization_id', orgId).in('id', unique);
    if (error) return json({ error: error.message }, 500);
    if (data?.length !== unique.length) return json({ error: 'Etiqueta indisponível nesta organização; atualize a lista' }, 400);
  }

  const { data, error } = await retryLabelWrite(() => 'addLabelIds' in body
    ? auth.admin.rpc('mutate_conversation_labels', { p_org: orgId, p_conversation: id, p_add: body.addLabelIds, p_remove: body.removeLabelIds })
    : auth.admin.from('wa_conversations').update('dealId' in body ? { deal_id: body.dealId } : { label_ids: [...new Set(body.labelIds)] })
      .eq('organization_id', orgId).eq('id', id).select('id,label_ids,deal_id').maybeSingle());
  if (error) return json({ error: error.message }, ['23514', '23503'].includes(error.code ?? '') ? 400 : 500);
  if (!data) return json({ error: 'Conversa não encontrada' }, 404);
  return json({ ok: true, conversation: Array.isArray(data) ? data[0] : data });
}
