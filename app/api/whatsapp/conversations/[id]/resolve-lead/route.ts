import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { getTeamAccess, visibleLead } from '@/lib/permissions/teamAccessServer';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isValidUUID } from '@/lib/supabase/utils';
import { retryLabelWrite } from '@/lib/whatsapp/conversationLabels';

export const runtime = 'nodejs';

/** Resolve only this open chat; never infer uniqueness from a browser/RLS-limited list. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'Conversa inválida' }, 400);
  const org = auth.user.organizationId;
  if (!(await conversationAllowed(auth.admin, auth.user, { id }))) return json({ error: 'Conversa indisponível' }, 404);
  const { data: conversation, error } = await auth.admin.from('wa_conversations')
    .select('id,contact_id,deal_id,deal_link_mode,is_group,label_ids').eq('organization_id', org).eq('id', id).maybeSingle();
  if (error) return json({ error: 'Não foi possível consultar o vínculo.' }, 500);
  if (!conversation) return json({ error: 'Conversa indisponível' }, 404);
  if (conversation.is_group || conversation.deal_id || !conversation.contact_id || conversation.deal_link_mode === 'manual') {
    return json({ conversation });
  }
  const { data: candidates, error: candidateError } = await auth.admin.from('deals')
    .select('id,board_id,owner_id').eq('organization_id', org).eq('contact_id', conversation.contact_id)
    .is('deleted_at', null).limit(2);
  if (candidateError) return json({ error: 'Não foi possível consultar o lead.' }, 500);
  if (candidates?.length !== 1) return json({ conversation });
  const candidate = candidates[0];
  const access = await getTeamAccess(auth.admin, org, auth.user.id);
  if (!visibleLead(access, auth.user.id, candidate.board_id, candidate.owner_id)) return json({ conversation });
  const { data, error: resolveError } = await retryLabelWrite(() => auth.admin.rpc('resolve_conversation_deal_link', {
    p_org: org, p_conversation: id, p_contact: conversation.contact_id, p_candidate: candidate.id,
    p_board: candidate.board_id, p_owner: candidate.owner_id,
  }));
  if (resolveError) return json({ error: 'Não foi possível atualizar o vínculo.' }, resolveError.code === '40001' ? 409 : 500);
  const resolved = Array.isArray(data) ? data[0] : data;
  if (!resolved) return json({ error: 'Conversa indisponível' }, 404);
  return json({ conversation: {
    id: resolved.id, contact_id: resolved.contact_id, deal_id: resolved.deal_id,
    deal_link_mode: resolved.deal_link_mode, is_group: resolved.is_group, label_ids: resolved.label_ids,
  } });
}
