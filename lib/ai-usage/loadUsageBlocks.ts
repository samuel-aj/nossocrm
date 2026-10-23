import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UsageBlockMap } from './alerts';

type RowResult<T> = { data: T[] | null; error: { message: string } | null };
type Conversation = { id: string; contact_id: string | null; wa_phone: string | null; is_group: boolean | null };
type Account = { id: string; merged_into: string | null; blocked_at: string | null; blocked_reason: string | null };

async function batched<T>(values: string[], read: (batch: string[], from: number, to: number) => PromiseLike<RowResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < values.length; start += 100) {
    const batch = values.slice(start, start + 100);
    for (let from = 0; ; from += 500) {
      const { data, error } = await read(batch, from, from + 499);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
  }
  return rows;
}

/**
 * Read-only projection for already authorized conversations, using the same
 * membership/contact/exact-phone candidates as ai_usage_budget. Never resolves
 * context through the mutating RPC and never reads token usage per card.
 */
export async function loadUsageBlocks(admin: SupabaseClient, organizationId: string, authorizedConversationIds: string[]): Promise<UsageBlockMap> {
  const ids = [...new Set(authorizedConversationIds)];
  if (!ids.length) return {};
  const conversations = await batched<Conversation>(ids, (batch, from, to) => admin.from('wa_conversations')
    .select('id,contact_id,wa_phone,is_group').eq('organization_id', organizationId).in('id', batch).order('id').range(from, to));
  const contactIds = [...new Set(conversations.flatMap(c => c.contact_id && !c.is_group ? [c.contact_id] : []))];
  const contacts = await batched<{ id: string }>(contactIds, (batch, from, to) => admin.from('contacts')
    .select('id').eq('organization_id', organizationId).in('id', batch).is('deleted_at', null).order('id').range(from, to));
  const verifiedContacts = new Set(contacts.map(c => c.id));
  const keysByConversation = new Map(conversations.map(c => {
    const phone = c.wa_phone === null ? null : `phone:${c.wa_phone}`;
    const primary = c.is_group ? `group:${c.id}`
      : c.contact_id && verifiedContacts.has(c.contact_id) ? `contact:${c.contact_id}` : phone;
    // Match SQL CASE plus IF NOT is_group: NULL still selects a primary
    // contact/phone identity, but does not qualify for the extra phone alias.
    return [c.id, [
      ...(primary ? [primary] : []),
      ...(c.is_group === false && phone ? [phone] : []),
    ]];
  }));
  const keys = [...new Set([...keysByConversation.values()].flat())];
  const [identities, memberships] = await Promise.all([
    batched<{ identity_key: string; account_id: string }>(keys, (batch, from, to) => admin.from('ai_usage_identities')
      .select('identity_key,account_id').eq('organization_id', organizationId).in('identity_key', batch).order('identity_key').range(from, to)),
    batched<{ conversation_id: string; account_id: string }>(conversations.map(c => c.id), (batch, from, to) => admin.from('ai_usage_memberships')
      .select('conversation_id,account_id').eq('organization_id', organizationId).in('conversation_id', batch).order('conversation_id').range(from, to)),
  ]);
  const identitiesByKey = new Map(identities.map(i => [i.identity_key, i.account_id]));
  const membershipsByConversation = new Map(memberships.map(m => [m.conversation_id, m.account_id]));
  const accounts = new Map<string, Account>();
  let pending = [...new Set([...identities.map(i => i.account_id), ...memberships.map(m => m.account_id)])];
  while (pending.length) {
    const rows = await batched<Account>(pending, (batch, from, to) => admin.from('ai_usage_accounts')
      .select('id,merged_into,blocked_at,blocked_reason').eq('organization_id', organizationId).in('id', batch).order('id').range(from, to));
    for (const row of rows) accounts.set(row.id, row);
    if (pending.some(id => !accounts.has(id))) throw new Error('Conta de consumo indisponível');
    pending = [...new Set(rows.flatMap(a => a.merged_into && !accounts.has(a.merged_into) ? [a.merged_into] : []))];
  }
  const canonical = (id: string): Account => {
    const visited = new Set<string>();
    let account = accounts.get(id);
    while (account?.merged_into) {
      if (visited.has(account.id)) throw new Error('Vínculo circular na conta de consumo');
      visited.add(account.id);
      account = accounts.get(account.merged_into);
    }
    if (!account) throw new Error('Conta de consumo indisponível');
    return account;
  };
  const result: UsageBlockMap = {};
  for (const conversation of conversations) {
    const candidates = [...new Set([
      membershipsByConversation.get(conversation.id),
      ...(keysByConversation.get(conversation.id) ?? []).map(key => identitiesByKey.get(key)),
    ].filter((id): id is string => !!id))];
    const blocked = candidates.map(canonical).filter(a => !!a.blocked_at)
      .sort((a, b) => a.blocked_at!.localeCompare(b.blocked_at!) || a.id.localeCompare(b.id))[0];
    if (blocked) result[conversation.id] = { conversationId: conversation.id, blockedAt: blocked.blocked_at!, reason: blocked.blocked_reason };
  }
  return result;
}
