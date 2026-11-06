import type { SupabaseClient } from '@supabase/supabase-js';

export async function loadLastInboundAt(admin: SupabaseClient, org: string, conversation: string, connection?: string | null): Promise<string | null> {
  let query = admin.from('wa_messages').select('created_at').eq('organization_id', org)
    .eq('conversation_id', conversation).eq('direction', 'in');
  if (connection) query = query.eq('connection_id', connection);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.created_at ?? null;
}
