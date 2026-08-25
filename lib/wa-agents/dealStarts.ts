/**
 * Gatilho por pipeline: fila `wa_ai_agent_deal_starts` (negócio criado ou que
 * entrou numa etapa). O agente inicia a conversa sozinho, com os dados do
 * cadastro no contexto. Chamado pelo /api/wa-agents/tick.
 *
 * Idempotente entre ticks: cada item passa por um update condicional
 * pending -> processing antes de ser processado; só quem conseguiu processa.
 * Nada aqui lança: o resultado fica no status/erro do item.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhoneE164 } from '@/lib/phone';
import { ensureConversation, getConnectionByIdForOrg } from '@/lib/whatsapp/service';
import { isWaAgentsBetaEnabled } from './beta';
import { loadAgent, loadConversationContext, type WaConversationFull } from './context';
import { runAgentOnConversation } from './engine';
import { errorMessage } from './errors';
import type { ConversationAiState, DealStartRow, DealStartStatus } from './types';
import { dispatchAgentEvent } from './webhooks';

export type ProcessDealStartsResult = { processed: number; done: number; errors: number; cancelled: number };

function nowIso(): string {
  return new Date().toISOString();
}

/** Marca o item com o status final (nunca lança). */
async function markDealStart(
  admin: SupabaseClient,
  row: Pick<DealStartRow, 'id' | 'organization_id'>,
  status: Exclude<DealStartStatus, 'pending' | 'processing'>,
  error?: string | null
): Promise<void> {
  try {
    await admin
      .from('wa_ai_agent_deal_starts')
      .update({ status, error: error ?? null, processed_at: nowIso() })
      .eq('id', row.id)
      .eq('organization_id', row.organization_id);
  } catch (e) {
    console.error('[wa-agents] marcar início pelo pipeline falhou:', errorMessage(e));
  }
}

/** Trava do item: pending -> processing. false se outro tick já pegou. */
async function claimDealStart(admin: SupabaseClient, row: Pick<DealStartRow, 'id' | 'organization_id'>): Promise<boolean> {
  const { data } = await admin
    .from('wa_ai_agent_deal_starts')
    .update({ status: 'processing' })
    .eq('id', row.id)
    .eq('organization_id', row.organization_id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  return !!data;
}

type Outcome = { status: 'done' | 'error' | 'cancelled'; reason?: string };

async function processDealStart(admin: SupabaseClient, row: DealStartRow): Promise<Outcome> {
  const orgId = row.organization_id;

  if (!(await isWaAgentsBetaEnabled(admin, orgId))) return { status: 'cancelled', reason: 'versão beta desativada' };

  const agent = await loadAgent(admin, orgId, row.agent_id);
  if (!agent) return { status: 'error', reason: 'agente não encontrado' };
  if (!agent.enabled) return { status: 'cancelled', reason: 'agente desligado' };
  if (!agent.triggers.deal.enabled) return { status: 'cancelled', reason: 'gatilho de pipeline desligado' };

  // Número que inicia a conversa
  const connectionId = agent.triggers.deal.connection_id;
  if (!connectionId) return { status: 'error', reason: 'gatilho sem número configurado' };
  const connection = await getConnectionByIdForOrg(admin, orgId, connectionId);
  if (!connection) return { status: 'error', reason: 'número não encontrado nesta organização' };
  if (connection.status !== 'connected') return { status: 'error', reason: 'número desconectado' };

  // Negócio e contato (telefone)
  if (!row.deal_id) return { status: 'error', reason: 'sem negócio' };
  const { data: dealRaw } = await admin
    .from('deals')
    .select('id, title, contact_id')
    .eq('organization_id', orgId)
    .eq('id', row.deal_id)
    .is('deleted_at', null)
    .maybeSingle();
  const deal = dealRaw as { id: string; title: string; contact_id: string | null } | null;
  if (!deal) return { status: 'error', reason: 'negócio não encontrado' };
  const contactId = row.contact_id ?? deal.contact_id ?? null;
  if (!contactId) return { status: 'error', reason: 'negócio sem contato' };
  const { data: contactRaw } = await admin
    .from('contacts')
    .select('id, name, phone')
    .eq('organization_id', orgId)
    .eq('id', contactId)
    .maybeSingle();
  const contact = contactRaw as { id: string; name: string | null; phone: string | null } | null;
  if (!contact) return { status: 'error', reason: 'contato não encontrado' };
  const phone = normalizePhoneE164(contact.phone || '');
  if (!phone) return { status: 'error', reason: 'contato sem telefone' };

  // Conversa no número do gatilho
  const conv = await ensureConversation(admin, orgId, connection.id, phone, contact.name ?? null);
  const { data: fullRaw } = await admin
    .from('wa_conversations')
    .select('*')
    .eq('id', conv.id)
    .eq('organization_id', orgId)
    .maybeSingle();
  const full = (fullRaw as WaConversationFull | null) ?? null;
  if (!full) return { status: 'error', reason: 'conversa não encontrada' };

  if (full.ai_agent_id && full.ai_status && ['active', 'awaiting_approval', 'paused'].includes(full.ai_status)) {
    return { status: 'cancelled', reason: `conversa já tem agente (${full.ai_status})` };
  }
  if (full.ai_status === 'stopped') return { status: 'cancelled', reason: 'agente parado nesta conversa' };
  if (!full.ai_agent_id && full.ai_status) return { status: 'cancelled', reason: 'conversa com agente externo' };

  const now = nowIso();
  const state: ConversationAiState = { origem: 'pipeline', deal_id: deal.id };
  const patch: Record<string, unknown> = {
    ai_agent_id: agent.id,
    ai_status: 'active',
    ai_status_changed_at: now,
    ai_state: state,
    ai_approval: null,
    ai_resume_at: null,
    ai_paused_by: null,
  };
  if (!full.deal_id) patch.deal_id = deal.id;
  if (!full.contact_id) patch.contact_id = contact.id;
  const { error: updErr } = await admin
    .from('wa_conversations')
    .update(patch)
    .eq('id', full.id)
    .eq('organization_id', orgId);
  if (updErr) return { status: 'error', reason: updErr.message };

  try {
    const ctx = await loadConversationContext(admin, orgId, full.id);
    await dispatchAgentEvent(admin, {
      agent,
      event: 'deal_started',
      ctx,
      extra: { deal_id: deal.id, deal_start_id: row.id, trigger_event: agent.triggers.deal.event },
    });
  } catch (e) {
    console.error('[wa-agents] webhook de início pelo pipeline falhou:', errorMessage(e));
  }

  const run = await runAgentOnConversation({
    organizationId: orgId,
    conversationId: full.id,
    trigger: 'deal',
    agentId: agent.id,
    forceReply: true,
    skipBuffer: true,
  });
  if (run.status === 'error') return { status: 'error', reason: run.reason || 'execução do agente falhou' };
  return { status: 'done', reason: run.status === 'skipped' ? run.reason : undefined };
}

export async function processDealStarts(
  admin: SupabaseClient,
  opts: { limit?: number; deadlineMs?: number } = {}
): Promise<ProcessDealStartsResult> {
  const limit = opts.limit ?? 5;
  const result: ProcessDealStartsResult = { processed: 0, done: 0, errors: 0, cancelled: 0 };
  try {
    const { data } = await admin
      .from('wa_ai_agent_deal_starts')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);

    for (const row of (data ?? []) as DealStartRow[]) {
      // Orçamento de tempo do tick: o que sobrar fica para o próximo
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
      if (!(await claimDealStart(admin, row))) continue;
      result.processed++;
      let outcome: Outcome;
      try {
        outcome = await processDealStart(admin, row);
      } catch (e) {
        outcome = { status: 'error', reason: errorMessage(e) };
      }
      if (outcome.status === 'error') console.error('[wa-agents] início pelo pipeline falhou:', outcome.reason);
      await markDealStart(admin, row, outcome.status, outcome.reason ?? null);
      if (outcome.status === 'done') result.done++;
      else if (outcome.status === 'error') result.errors++;
      else result.cancelled++;
    }
  } catch (e) {
    console.error('[wa-agents] busca de inícios pelo pipeline falhou:', errorMessage(e));
  }
  return result;
}
