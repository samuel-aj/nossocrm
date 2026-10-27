/**
 * Qual conversa do WhatsApp pertence a um negócio: as ligadas a ele; sem
 * nenhuma, a do contato, mas só quando o contato não tem OUTRO lead aberto
 * (senão a mensagem de um lead cairia na conversa de outro). Usado pelo
 * follow-up por inatividade e pelo envio de contrato para assinatura. SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type DealConversation = {
  id: string;
  connection_id: string | null;
  wa_phone: string | null;
  deal_id: string | null;
  contact_id: string | null;
  last_message_at: string | null;
};

export type DealConversationResult =
  | { ok: true; conversation: DealConversation | null; all: DealConversation[] }
  | { ok: false; reason: string; all: DealConversation[] };

export async function resolveDealConversation(
  admin: SupabaseClient,
  orgId: string,
  deal: { id: string; contact_id: string | null }
): Promise<DealConversationResult> {
  let convQuery = admin
    .from('wa_conversations')
    .select('id, connection_id, wa_phone, deal_id, contact_id, last_message_at, is_group')
    .eq('organization_id', orgId);
  convQuery = deal.contact_id ? convQuery.or(`deal_id.eq.${deal.id},contact_id.eq.${deal.contact_id}`) : convQuery.eq('deal_id', deal.id);
  const { data: convRows } = await convQuery;
  const all = ((convRows ?? []) as Array<DealConversation & { is_group?: boolean | null }>).filter((c) => !c.is_group);

  const newest = (list: DealConversation[]) =>
    [...list].sort((a, b) => Date.parse(b.last_message_at ?? '0') - Date.parse(a.last_message_at ?? '0'))[0] ?? null;
  const linked = all.filter((c) => c.deal_id === deal.id);
  let conv: DealConversation | null = newest(linked);
  if (!conv && all.length > 0) {
    const { count } = await admin
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('contact_id', deal.contact_id as string)
      .is('deleted_at', null)
      .eq('is_won', false)
      .eq('is_lost', false);
    if ((count ?? 0) > 1) {
      return { ok: false, reason: 'o contato tem mais de um lead aberto e nenhuma conversa ligada a este lead', all };
    }
    conv = newest(all);
  }
  return { ok: true, conversation: conv, all };
}

/** Mensagem recebida do lead mais recente nas conversas dadas. */
export async function lastInboundAt(admin: SupabaseClient, convIds: string[]): Promise<string | null> {
  if (convIds.length === 0) return null;
  const { data } = await admin
    .from('wa_messages')
    .select('created_at')
    .in('conversation_id', convIds)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { created_at?: string } | null)?.created_at ?? null;
}
