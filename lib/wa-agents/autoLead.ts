/**
 * Lead automático do agente: quando o contato da conversa não tem NENHUM
 * negócio aberto, o agente cria um antes de atender (configuração auto_lead).
 *
 * Sem duplicar: roda DENTRO da trava por conversa do motor (execuções da mesma
 * conversa são em série) e reconfere o negócio aberto do contato logo antes do
 * insert. Contato inexistente no CRM é criado junto (nome do WhatsApp ou o
 * número), reaproveitando um contato já existente com o mesmo telefone.
 *
 * O responsável NÃO é definido aqui: o gatilho de distribuição de leads da org
 * (trg_assign_deal_owner) decide, como em qualquer lead novo.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { brPhoneVariants } from '@/lib/phone';
import { loadDealContext, type ConversationContext } from './context';
import { errorMessage } from './errors';
import type { AgentRow } from './types';

type PushEvent = (type: string, extra?: Record<string, unknown>) => void;

/** Primeiro quadro da organização e/ou a primeira etapa do quadro. */
async function resolveBoardStage(
  admin: SupabaseClient,
  organizationId: string,
  boardId: string | null,
  stageId: string | null
): Promise<{ boardId: string; stageId: string } | { error: string }> {
  let board = boardId;
  if (board) {
    // Quadro apagado depois de configurado: cai no primeiro quadro em vez de criar lead órfão
    const { data } = await admin
      .from('boards')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', board)
      .is('deleted_at', null)
      .maybeSingle();
    if (!data) board = null;
  }
  if (!board) {
    const { data } = await admin
      .from('boards')
      .select('id')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    board = (data as { id: string } | null)?.id ?? null;
  }
  if (!board) return { error: 'organização sem quadro' };

  let stage = stageId;
  if (stage) {
    const { data } = await admin
      .from('board_stages')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('board_id', board)
      .eq('id', stage)
      .maybeSingle();
    if (!data) stage = null;
  }
  if (!stage) {
    const { data } = await admin
      .from('board_stages')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('board_id', board)
      .order('order', { ascending: true })
      .limit(1)
      .maybeSingle();
    stage = (data as { id: string } | null)?.id ?? null;
  }
  if (!stage) return { error: 'quadro sem etapas' };
  return { boardId: board, stageId: stage };
}

/** Contato da conversa; sem contato, acha pelo telefone ou cria. null = sem telefone utilizável. */
async function ensureContact(
  admin: SupabaseClient,
  ctx: ConversationContext,
  pushEvent: PushEvent
): Promise<string | null> {
  const conv = ctx.conversation;
  if (conv.contact_id) return conv.contact_id;

  const phone = (conv.wa_phone || '').trim();
  if (!phone) return null;

  // Mesmo telefone em outra grafia (com/sem o nono dígito) conta como o mesmo contato
  const variants = brPhoneVariants(phone);
  const { data: existing } = await admin
    .from('contacts')
    .select('id')
    .eq('organization_id', conv.organization_id)
    .in('phone', variants.length ? variants : [phone])
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  let contactId = (existing as { id: string } | null)?.id ?? null;

  if (!contactId) {
    const name = (conv.wa_name || '').trim() || phone;
    const { data: created, error } = await admin
      .from('contacts')
      .insert({ organization_id: conv.organization_id, name, phone, stage: 'LEAD' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    contactId = (created as { id: string }).id;
    pushEvent('auto_lead_contato_criado', { contact_id: contactId, nome: name });
  }

  // Liga a conversa ao contato (o gatilho wa_link_orphans só cobre contato novo)
  await admin
    .from('wa_conversations')
    .update({ contact_id: contactId })
    .eq('organization_id', conv.organization_id)
    .eq('id', conv.id);
  ctx.conversation.contact_id = contactId;
  return contactId;
}

/**
 * Garante o lead da conversa quando auto_lead está ligado. Atualiza ctx.deal
 * (e ctx.conversation.deal_id) quando cria. Nunca lança: erro vira evento.
 */
export async function ensureAutoLead(
  admin: SupabaseClient,
  input: { agent: AgentRow; ctx: ConversationContext; pushEvent: PushEvent }
): Promise<void> {
  const { agent, ctx, pushEvent } = input;
  if (!agent.auto_lead.enabled) return;
  if (ctx.deal) return; // já tem negócio aberto (ou ligado à conversa)
  if (ctx.conversation.ai_state?.origem === 'pipeline') return; // veio DO cadastro de um lead

  try {
    const orgId = ctx.conversation.organization_id;
    const contactId = await ensureContact(admin, ctx, pushEvent);
    if (!contactId) {
      pushEvent('auto_lead_pulado', { motivo: 'conversa sem telefone utilizável' });
      return;
    }

    // Reconfere DEPOIS de resolver o contato: um negócio aberto de um contato
    // recém-vinculado (mesmo telefone) já atende — não cria outro.
    const { data: aberto } = await admin
      .from('deals')
      .select('id')
      .eq('organization_id', orgId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .eq('is_won', false)
      .eq('is_lost', false)
      .limit(1)
      .maybeSingle();
    if (aberto) {
      ctx.deal = await loadDealContext(admin, orgId, { contactId });
      pushEvent('auto_lead_pulado', { motivo: 'contato já tem negócio aberto', deal_id: (aberto as { id: string }).id });
      return;
    }

    const destino = await resolveBoardStage(admin, orgId, agent.auto_lead.board_id, agent.auto_lead.stage_id);
    if ('error' in destino) {
      pushEvent('auto_lead_pulado', { motivo: destino.error });
      return;
    }

    const titulo = (ctx.contact?.name || ctx.conversation.wa_name || ctx.conversation.wa_phone || 'Novo lead').trim();
    const { data: deal, error } = await admin
      .from('deals')
      .insert({
        organization_id: orgId,
        title: titulo,
        board_id: destino.boardId,
        stage_id: destino.stageId,
        contact_id: contactId,
        value: 0,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const dealId = (deal as { id: string }).id;

    await admin
      .from('wa_conversations')
      .update({ deal_id: dealId })
      .eq('organization_id', orgId)
      .eq('id', ctx.conversation.id);
    ctx.conversation.deal_id = dealId;
    ctx.deal = await loadDealContext(admin, orgId, { dealId });
    pushEvent('auto_lead_criado', { deal_id: dealId, board_id: destino.boardId, stage_id: destino.stageId });
  } catch (e) {
    pushEvent('auto_lead_falhou', { erro: errorMessage(e) });
  }
}
