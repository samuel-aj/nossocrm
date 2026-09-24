import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgUser } from '@/lib/whatsapp/api';
import { connectionAllowed, filterConversationsByOwner, getVisibilityRules } from '@/lib/permissions/server';
import { buildAutomationMap, type AutomationConversation, type AutomationRun } from './automationState';

type PageResult<T> = { data: T[] | null; error: { message: string } | null };
/** No silent PostgREST 1,000-row truncation (including contact fallback across boards). */
async function pages<T>(read: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await read(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}
type Conversation = AutomationConversation & { connection_id: string | null; label_ids: string[] | null };

export async function loadAutomationState(admin: SupabaseClient, user: OrgUser, deals: { id: string; contact_id: string | null }[]) {
  if (!deals.length) return {};
  const org = user.organizationId;
  const ids = deals.map(d => d.id);
  const contacts = [...new Set(deals.flatMap(d => d.contact_id ? [d.contact_id] : []))];
  const targets = [`deal_id.in.(${ids.join(',')})`, ...(contacts.length ? [`contact_id.in.(${contacts.join(',')})`] : [])].join(',');
  const [runs, conversationRows, rules, openDeals] = await Promise.all([
    pages<AutomationRun>((from, to) => admin.from('wa_bot_runs')
      .select('id,deal_id,contact_id,conversation_id,bot_id,status,wake_at')
      .eq('organization_id', org).in('status', ['running', 'waiting_reply']).or(targets)
      .order('updated_at', { ascending: false }).order('id').range(from, to)),
    pages<Conversation>((from, to) => admin.from('wa_conversations')
      .select('id,deal_id,contact_id,connection_id,label_ids,ai_status,ai_agent_id')
      .eq('organization_id', org).or(targets).order('id').range(from, to)),
    getVisibilityRules(admin, org, user.id, user.role),
    contacts.length ? pages<{ id: string; contact_id: string }>((from, to) => admin.from('deals')
      .select('id,contact_id').eq('organization_id', org).in('contact_id', contacts)
      .is('deleted_at', null).eq('is_won', false).eq('is_lost', false)
      .order('updated_at', { ascending: false }).order('id').range(from, to)) : Promise.resolve([]),
  ]);
  // A run can have an explicit deal with a conversation that has no contact link yet.
  const seen = new Set(conversationRows.map(c => c.id));
  const missing = [...new Set(runs.flatMap(r => r.conversation_id && !seen.has(r.conversation_id) ? [r.conversation_id] : []))];
  for (let start = 0; start < missing.length; start += 100) {
    conversationRows.push(...await pages<Conversation>((from, to) => admin.from('wa_conversations')
      .select('id,deal_id,contact_id,connection_id,label_ids,ai_status,ai_agent_id')
      .eq('organization_id', org).in('id', missing.slice(start, start + 100)).order('id').range(from, to)));
  }
  const conversations = await filterConversationsByOwner(admin, org, rules, user.id, conversationRows.filter(c =>
    connectionAllowed(rules, c.connection_id) && (!rules?.whatsapp.label_ids || rules.whatsapp.label_ids.some(id => (c.label_ids || []).includes(id)))));
  const botIds = [...new Set(runs.map(r => r.bot_id))];
  const agentIds = [...new Set(conversations.flatMap(c => c.ai_agent_id ? [c.ai_agent_id] : []))];
  async function names(table: string, values: string[]) {
    const result = new Map<string, string>();
    for (let start = 0; start < values.length; start += 100) {
      const rows = await pages<{ id: string; name: string }>((from, to) => admin.from(table).select('id,name')
        .eq('organization_id', org).in('id', values.slice(start, start + 100)).order('id').range(from, to));
      for (const row of rows) result.set(row.id, row.name);
    }
    return result;
  }
  const [botNames, agentNames] = await Promise.all([names('wa_bots', botIds), names('wa_ai_agents', agentIds)]);
  const latestOpenDealByContact = new Map<string, string>();
  for (const deal of openDeals) if (!latestOpenDealByContact.has(deal.contact_id)) latestOpenDealByContact.set(deal.contact_id, deal.id);
  return buildAutomationMap({ dealIds: ids, runs, conversations, latestOpenDealByContact, botNames, agentNames });
}
