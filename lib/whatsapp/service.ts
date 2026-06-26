/**
 * Camada de dados do WhatsApp (server-side, via service role).
 * Centraliza leitura/escrita das tabelas wa_* para as rotas e (futuramente) o webhook.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface WaConnectionRow {
  id: string;
  organization_id: string;
  provider: string;
  instance_name: string;
  instance_token: string | null;
  base_url: string | null;
  phone_number: string | null;
  profile_name: string | null;
  status: string;
  webhook_secret: string;
  last_connected_at: string | null;
}

export interface WaConversationRow {
  id: string;
  organization_id: string;
  connection_id: string | null;
  contact_id: string | null;
  wa_phone: string;
  wa_name: string | null;
  last_message_at: string | null;
}

export interface WaMessageRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  status: string;
  body: string | null;
  evolution_message_id: string | null;
  created_at: string;
}

export async function getConnectionByOrg(
  admin: SupabaseClient,
  orgId: string
): Promise<WaConnectionRow | null> {
  const { data } = await admin
    .from('wa_connections')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle();
  return (data as WaConnectionRow) ?? null;
}

export async function getConnectionByInstance(
  admin: SupabaseClient,
  instanceName: string
): Promise<WaConnectionRow | null> {
  const { data } = await admin
    .from('wa_connections')
    .select('*')
    .eq('instance_name', instanceName)
    .maybeSingle();
  return (data as WaConnectionRow) ?? null;
}

export async function upsertConnection(
  admin: SupabaseClient,
  orgId: string,
  input: { instanceName: string; token?: string | null; baseUrl?: string | null }
): Promise<WaConnectionRow> {
  const { data, error } = await admin
    .from('wa_connections')
    .upsert(
      {
        organization_id: orgId,
        provider: 'evolution',
        instance_name: input.instanceName,
        instance_token: input.token ?? null,
        base_url: input.baseUrl ?? null,
      },
      { onConflict: 'organization_id' }
    )
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as WaConnectionRow;
}

export async function updateConnectionStatus(
  admin: SupabaseClient,
  id: string,
  fields: { status?: string; phone_number?: string | null; profile_name?: string | null }
): Promise<void> {
  const patch: Record<string, unknown> = { ...fields };
  if (fields.status === 'connected') patch.last_connected_at = new Date().toISOString();
  await admin.from('wa_connections').update(patch).eq('id', id);
}

/** Casa um telefone E.164 com um contato da org (match exato). */
export async function matchContactByPhone(
  admin: SupabaseClient,
  orgId: string,
  e164: string
): Promise<string | null> {
  if (!e164) return null;
  const { data } = await admin
    .from('contacts')
    .select('id')
    .eq('organization_id', orgId)
    .eq('phone', e164)
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Acha a conversa por telefone na org, ou cria uma nova (casando contato). */
export async function ensureConversation(
  admin: SupabaseClient,
  orgId: string,
  connectionId: string | null,
  waPhone: string,
  waName?: string | null
): Promise<WaConversationRow> {
  const { data: existing } = await admin
    .from('wa_conversations')
    .select('*')
    .eq('organization_id', orgId)
    .eq('wa_phone', waPhone)
    .maybeSingle();
  if (existing) return existing as WaConversationRow;

  const contactId = await matchContactByPhone(admin, orgId, waPhone);
  const { data, error } = await admin
    .from('wa_conversations')
    .insert({
      organization_id: orgId,
      connection_id: connectionId,
      contact_id: contactId,
      wa_phone: waPhone,
      wa_name: waName ?? null,
    })
    .select('*')
    .single();
  if (error) {
    // corrida com outra inserção (constraint org+phone): relê
    const { data: again } = await admin
      .from('wa_conversations')
      .select('*')
      .eq('organization_id', orgId)
      .eq('wa_phone', waPhone)
      .maybeSingle();
    if (again) return again as WaConversationRow;
    throw new Error(error.message);
  }
  return data as WaConversationRow;
}

async function touchConversation(
  admin: SupabaseClient,
  conversationId: string,
  preview: string
): Promise<void> {
  await admin
    .from('wa_conversations')
    .update({ last_message_at: new Date().toISOString(), last_message_preview: preview.slice(0, 140) })
    .eq('id', conversationId);
}

export async function recordOutboundMessage(
  admin: SupabaseClient,
  input: {
    orgId: string;
    conversationId: string;
    text: string;
    providerMessageId?: string | null;
    fromPhone?: string | null;
    toPhone: string;
    sentBy: string;
    status?: string;
    error?: string | null;
  }
): Promise<WaMessageRow> {
  const { data, error } = await admin
    .from('wa_messages')
    .insert({
      organization_id: input.orgId,
      conversation_id: input.conversationId,
      direction: 'out',
      status: input.status ?? 'sent',
      body: input.text,
      evolution_message_id: input.providerMessageId ?? null,
      from_phone: input.fromPhone ?? null,
      to_phone: input.toPhone,
      sent_by: input.sentBy,
      error: input.error ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  await touchConversation(admin, input.conversationId, input.text);
  return data as WaMessageRow;
}
