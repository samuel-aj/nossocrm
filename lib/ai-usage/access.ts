import type { SupabaseClient } from '@supabase/supabase-js';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { effectiveOwnersByContact } from '@/lib/permissions/server';
import { isOrgAdmin, type OrgUser } from '@/lib/whatsapp/api';

/** Visibility alone does not authorize additional spending. Owner resolution matches Chats. */
export async function conversationUsageAccess(admin: SupabaseClient, user: OrgUser, id: string): Promise<{ allowed: boolean; canGrant: boolean }> {
  if (!(await conversationAllowed(admin, user, { id }))) return { allowed: false, canGrant: false };
  if (isOrgAdmin(user.role)) return { allowed: true, canGrant: true };
  const { data, error } = await admin.from('wa_conversations').select('contact_id').eq('organization_id', user.organizationId).eq('id', id).maybeSingle();
  if (error) throw new Error('Não foi possível conferir o responsável');
  if (!data) return { allowed: false, canGrant: false };
  const owners = await effectiveOwnersByContact(admin, user.organizationId, data.contact_id ? [data.contact_id] : []);
  return { allowed: true, canGrant: !!data.contact_id && owners.get(data.contact_id) === user.id };
}
