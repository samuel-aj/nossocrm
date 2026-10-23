import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgUser } from '@/lib/whatsapp/api';
import type { Notice } from '@/lib/notifications/types';
import { conversationUsageAccess } from './access';

/** Internal alerts only. Never sends WhatsApp messages or dispatches agent webhooks. */
export async function usageNotices(admin: SupabaseClient, user: OrgUser, from: string | null, until: string): Promise<Notice[]> {
  const notices: Notice[] = [];
  let afterId: string | undefined;
  for (;;) {
    let query = admin.from('ai_usage_notices')
      .select('id,conversation_id,created_at').eq('organization_id', user.organizationId)
      .is('resolved_at', null).lte('created_at', until)
      .order('id');
    if (from) query = query.gte('created_at', from);
    if (afterId) query = query.gt('id', afterId);
    const { data, error } = await query.limit(200);
    if (error) throw error;
    for (const row of data ?? []) {
      if (!row.conversation_id) continue;
      const access = await conversationUsageAccess(admin, user, row.conversation_id);
      if (!access.allowed || !access.canGrant) continue;
      notices.push({ id: `ai-usage-${row.id}`, kind: 'alert', title: 'IA pausada por consumo',
        message: 'Um atendimento precisa de liberação manual de saldo. O atendimento humano continua disponível.',
        href: `/chats?conversation=${row.conversation_id}`, createdAt: row.created_at });
    }
    if (!data || data.length < 200) break;
    afterId = data[data.length - 1].id;
  }
  return notices;
}
