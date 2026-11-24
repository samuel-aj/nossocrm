import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { context, visibleJournalNotices } from './server';

interface PushTarget {
  organization_id: string;
  user_id: string;
  event_id: string;
  message_id: string;
}

const NEW_LEAD_GRACE_MS = 5 * 60_000;

/** A queued job grants no access. Check the current viewer, message and lead again before sending. */
export async function loadAuthorizedPushMessage(admin: SupabaseClient, target: PushTarget) {
  const { organization_id: org, user_id: user, event_id: eventId, message_id: messageId } = target;
  const [membership, event] = await Promise.all([
    admin.rpc('crm_push_recipient_role', { p_org: org, p_user: user }),
    admin.from('crm_notification_events').select('id,kind,source_id,board_id,created_at')
      .eq('organization_id', org).eq('id', eventId).eq('source_id', messageId).eq('kind', 'message').maybeSingle(),
  ]);
  if (membership.error) throw membership.error;
  if (event.error) throw event.error;
  if (!event.data || typeof membership.data !== 'string' || !membership.data) return null;
  const auth = { ok: true as const, admin, user: { id: user, organizationId: org, role: membership.data } };
  const ctx = await context(auth);
  if (!ctx.preferences.messages) return null;
  const receivedAt = Date.parse(event.data.created_at);
  const notices = await visibleJournalNotices(auth, ctx, [event.data], conversationCreatedAt => {
    // The first inbound and push job commit before ensureAutoLead links the lead.
    // Ask the existing retry queue to recheck this fresh chat; only a linked,
    // currently visible lead can produce a notification on a later attempt.
    const chatAgeAtReceipt = receivedAt - Date.parse(conversationCreatedAt);
    if (ctx.boards.length && chatAgeAtReceipt >= 0 && chatAgeAtReceipt <= NEW_LEAD_GRACE_MS
      && Date.now() - receivedAt < NEW_LEAD_GRACE_MS) {
      throw new Error('O primeiro atendimento ainda aguarda o vínculo com um lead.');
    }
  });
  const conversationId = notices[0]?.conversationId;
  return conversationId ? { conversationId } : null;
}
