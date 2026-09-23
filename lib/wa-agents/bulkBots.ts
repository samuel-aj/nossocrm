import type { SupabaseClient } from '@supabase/supabase-js';
import { isE164, normalizePhoneE164 } from '@/lib/phone';
import { botConnectionIds } from './bots';
import type { BotRow } from './types';

export const MAX_BULK_LEADS = 500;
export type BulkRecipient = { dealId: string; title: string; contactId?: string; phone?: string; eligible: boolean; reason?: string };
export type BulkRunResult = { dealId: string; runId?: string; status: 'queued' | 'existing' | 'skipped'; reason?: string };

export async function prepareBulkBot(admin: SupabaseClient, org: string, botId: string, dealIds: string[]) {
  const { data: bot, error: botError } = await admin.from('wa_bots').select('*').eq('organization_id', org).eq('id', botId).maybeSingle();
  if (botError) throw botError;
  if (!bot?.enabled) throw new Error('Escolha um robô ativo.');
  const needsConversation = (bot.steps ?? []).some((s: { type: string }) => ['send_text','send_template','typing','wait_reply','handoff_agent','start_bot'].includes(s.type));
  const ids = botConnectionIds(bot as BotRow);
  const connectionId = ids.includes(bot.trigger?.connection_id) ? bot.trigger.connection_id : ids[0];
  if (needsConversation) {
    if (!connectionId) throw new Error('Configure o número de envio do robô.');
    const { data: connection, error } = await admin.from('wa_connections').select('id, status').eq('organization_id', org).eq('id', connectionId).maybeSingle();
    if (error) throw error;
    if (connection?.status !== 'connected') throw new Error('O número de envio do robô está desconectado.');
  }
  const { data: deals, error } = await admin.from('deals').select('id, title, contact_id').eq('organization_id', org).in('id', dealIds).is('deleted_at', null);
  if (error) throw error;
  const contactIds = [...new Set((deals ?? []).map(d => d.contact_id).filter(Boolean))];
  const contactsResult = contactIds.length ? await admin.from('contacts').select('id, phone').eq('organization_id', org).in('id', contactIds).is('deleted_at', null) : { data: [], error: null };
  if (contactsResult.error) throw contactsResult.error;
  const contacts = new Map<string, { phone: string | null }>((contactsResult.data ?? []).map(c => [c.id, c] as const));
  const seen = new Set<string>();
  const recipients: BulkRecipient[] = dealIds.map(dealId => {
    const deal = (deals ?? []).find(d => d.id === dealId);
    const base = { dealId, title: deal?.title ?? 'Lead indisponível', eligible: false };
    if (!deal) return { ...base, reason: 'Lead removido ou sem acesso' };
    const phone = normalizePhoneE164(contacts.get(deal.contact_id)?.phone ?? '');
    if (!isE164(phone) || phone.length < 8) return { ...base, reason: 'Contato sem telefone válido' };
    if (seen.has(phone)) return { ...base, phone, reason: 'Telefone repetido neste lote' };
    seen.add(phone);
    return { ...base, contactId: deal.contact_id, phone, eligible: true };
  });
  return { botName: bot.name as string, recipients };
}
