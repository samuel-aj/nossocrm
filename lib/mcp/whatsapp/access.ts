import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgUser } from '@/lib/whatsapp/api';
import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { getConnectionByIdForOrg, getWaGroupsEnabled, type WaConversationRow } from '@/lib/whatsapp/service';

export type WhatsAppContext = { admin: SupabaseClient; user: OrgUser; apiKeyId: string };
export class McpWhatsAppError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export function unavailable(): never {
  throw new McpWhatsAppError('UNAVAILABLE', 'Registro indisponível ou sem permissão.');
}
export function checkDb(error: unknown) {
  if (error) throw new McpWhatsAppError('STORAGE_UNAVAILABLE', 'Não foi possível consultar ou registrar a operação. Consulte o resultado antes de retomar.');
}

/** API-key owner, not browser session/header/user input, is the audit actor. */
export async function resolveMcpOwner(admin: SupabaseClient, apiKeyId: string, organizationId: string): Promise<OrgUser | null> {
  const { data: key, error } = await admin.from('api_keys').select('created_by').eq('id', apiKeyId).eq('organization_id', organizationId).maybeSingle();
  if (error || !key?.created_by) return null;
  const { data: account, error: accountError } = await admin.auth.admin.getUserById(key.created_by);
  const bannedUntil = (account?.user as { banned_until?: string } | undefined)?.banned_until;
  const deletedAt = (account?.user as { deleted_at?: string } | undefined)?.deleted_at;
  if (accountError || !account?.user || deletedAt || (bannedUntil && Date.parse(bannedUntil) > Date.now())) return null;
  const { data: profile, error: profileError } = await admin.from('profiles').select('id,role,organization_id').eq('id', key.created_by).maybeSingle();
  if (profileError || !profile) return null;
  const { data: org, error: orgError } = await admin.from('organizations').select('id,is_active').eq('id', organizationId).maybeSingle();
  if (orgError || !org || org.is_active === false) return null;
  const { data: membership, error: memberError } = await admin.from('user_organizations').select('role').eq('user_id', profile.id).eq('organization_id', organizationId).maybeSingle();
  if (memberError) return null;
  const role = profile.role === 'super_admin' ? 'super_admin' : membership?.role ?? (profile.organization_id === organizationId ? profile.role : null);
  return role ? { id: profile.id, role, organizationId } : null;
}

export async function requireDestination(ctx: WhatsAppContext, conversationId: string, connectionId: string) {
  const { admin, user } = ctx;
  if (!(await conversationAllowed(admin, user, { id: conversationId, connectionId }))) unavailable();
  const { data, error } = await admin.from('wa_conversations')
    .select('id,organization_id,connection_id,contact_id,wa_phone,wa_name,last_message_at,is_group,group_jid')
    .eq('organization_id', user.organizationId).eq('id', conversationId).eq('connection_id', connectionId).maybeSingle();
  checkDb(error);
  if (!data) unavailable();
  if (data.is_group && !(await getWaGroupsEnabled(admin, user.organizationId))) unavailable();
  const connection = await getConnectionByIdForOrg(admin, user.organizationId, connectionId);
  if (!connection) unavailable();
  return { conversation: data as WaConversationRow, connection };
}
