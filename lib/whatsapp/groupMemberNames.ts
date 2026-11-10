import type { SupabaseClient } from '@supabase/supabase-js';
import { participantName, type GroupParticipant } from './groupParticipants';

/** Only consider senders from this visible conversation who are still in its roster. */
export async function withGroupSenderNames(admin: SupabaseClient, orgId: string, conversationId: string, members: GroupParticipant[]) {
  const phones = [...new Set(members.flatMap(m => m.phone && !participantName(m.name) ? [m.phone] : []))];
  const names = new Map<string, string>();
  for (let start = 0; start < phones.length; start += 50) {
    const missing = new Set(phones.slice(start, start + 50));
    let offset = 0;
    while (missing.size) {
      const { data, error } = await admin.from('wa_messages').select('from_phone,sender_name')
        .eq('organization_id', orgId).eq('conversation_id', conversationId).eq('direction', 'in')
        .is('deleted_at', null).not('sender_name', 'is', null).in('from_phone', [...missing])
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 99);
      if (error || !data?.length) break;
      const before = missing.size;
      for (const row of data) {
        const name = participantName(row.sender_name);
        if (name && missing.delete(row.from_phone)) names.set(row.from_phone, name);
      }
      if (data.length < 100) break;
      offset = missing.size === before ? offset + data.length : 0;
    }
  }
  return members.map(m => m.phone && names.has(m.phone) ? { ...m, name: names.get(m.phone)! } : m);
}
