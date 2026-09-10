import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgUser } from '@/lib/whatsapp/api';
import { brPhoneVariants } from '@/lib/phone';
import { getVisibilityRules, connectionAllowed, filterConversationsByOwner } from './server';
export async function conversationAllowed(admin: SupabaseClient, user: OrgUser, target: { id?: string; phone?: string; connectionId?: string }): Promise<boolean> {
  const rules = await getVisibilityRules(admin, user.organizationId, user.id, user.role);
  let q = admin.from('wa_conversations').select('id,contact_id,connection_id,label_ids').eq('organization_id', user.organizationId);
  if (target.id) q = q.eq('id', target.id);
  else if (target.phone) q = q.in('wa_phone', brPhoneVariants(target.phone));
  else return false;
  if (target.connectionId && target.connectionId !== 'none') q = q.eq('connection_id', target.connectionId);
  if (target.connectionId === 'none') q = q.is('connection_id', null);
  const { data, error } = await q;
  if (error) throw error;
  const permitted = (data || []).filter(c => connectionAllowed(rules, c.connection_id) &&
    (!rules?.whatsapp.label_ids || rules.whatsapp.label_ids.some(id => (c.label_ids || []).includes(id))));
  return (await filterConversationsByOwner(admin, user.organizationId, rules, user.id, permitted)).length > 0;
}
