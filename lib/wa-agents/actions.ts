/**
 * Esteira do encerramento: executa as ações de um resultado (nota, etapa,
 * rótulo, perdido, responsável, tarefa). handoff/approval/stop só são
 * devolvidos: quem aplica é o motor.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { moveStageByDealId } from '@/lib/public-api/dealsMoveStage';
import type { ConversationContext } from './context';
import { errorMessage } from './errors';
import type { AgentRow, EndAction, Outcome } from './types';

export type OutcomeActionsResult = { handoffAgentId?: string; approvalAgentId?: string; stopped?: boolean };

/** Adiciona um rótulo ao negócio (sem duplicar). */
export async function addDealTag(
  admin: SupabaseClient,
  organizationId: string,
  dealId: string,
  tag: string
): Promise<void> {
  const { data } = await admin
    .from('deals')
    .select('tags')
    .eq('organization_id', organizationId)
    .eq('id', dealId)
    .maybeSingle();
  const current: string[] = Array.isArray((data as { tags?: string[] } | null)?.tags)
    ? ((data as { tags: string[] }).tags ?? [])
    : [];
  const clean = tag.trim();
  if (!clean || current.some(t => t.toLowerCase() === clean.toLowerCase())) return;
  const { error } = await admin
    .from('deals')
    .update({ tags: [...current, clean], updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('id', dealId);
  if (error) throw new Error(error.message);
}

async function runAction(
  admin: SupabaseClient,
  input: { agent: AgentRow; ctx: ConversationContext; outcome: Outcome; summary: string },
  action: EndAction,
  result: OutcomeActionsResult
): Promise<string> {
  const { ctx, outcome, summary } = input;
  const orgId = ctx.conversation.organization_id;
  const dealId = ctx.deal?.id ?? null;
  const contactId = ctx.contact?.id ?? ctx.conversation.contact_id ?? null;
  const now = new Date();

  switch (action.type) {
    case 'note': {
      const { error } = await admin.from('activities').insert({
        organization_id: orgId,
        type: 'note',
        title: action.title?.trim() || `Pré-atendimento IA: ${outcome.label}`,
        description: summary,
        date: now.toISOString(),
        completed: true,
        deal_id: dealId,
        contact_id: contactId,
      });
      if (error) throw new Error(error.message);
      return 'nota registrada';
    }
    case 'move_stage': {
      if (!dealId) return 'sem negócio: etapa ignorada';
      const r = await moveStageByDealId({ organizationId: orgId, dealId, target: { to_stage_id: action.stage_id } });
      if (!r.ok) throw new Error((r.body as { error?: string }).error || 'falha ao mover etapa');
      return 'negócio movido de etapa';
    }
    case 'add_tag': {
      if (!dealId) return 'sem negócio: rótulo ignorado';
      await addDealTag(admin, orgId, dealId, action.tag);
      return `rótulo "${action.tag}" adicionado`;
    }
    case 'mark_lost': {
      if (!dealId) return 'sem negócio: perda ignorada';
      const { error } = await admin
        .from('deals')
        .update({
          is_lost: true,
          is_won: false,
          closed_at: now.toISOString(),
          loss_reason: action.loss_reason?.trim() || null,
          updated_at: now.toISOString(),
        })
        .eq('organization_id', orgId)
        .eq('id', dealId);
      if (error) throw new Error(error.message);
      return 'negócio marcado como perdido';
    }
    case 'assign_owner': {
      const notes: string[] = [];
      if (dealId) {
        const { error } = await admin
          .from('deals')
          .update({ owner_id: action.owner_id, updated_at: now.toISOString() })
          .eq('organization_id', orgId)
          .eq('id', dealId);
        if (error) throw new Error(error.message);
        notes.push('responsável do negócio atualizado');
      }
      const { error: convErr } = await admin
        .from('wa_conversations')
        .update({ assigned_owner_id: action.owner_id })
        .eq('organization_id', orgId)
        .eq('id', ctx.conversation.id);
      if (convErr) throw new Error(convErr.message);
      notes.push('responsável da conversa atualizado');
      return notes.join(', ');
    }
    case 'create_task': {
      const due = new Date(now.getTime() + (action.days ?? 0) * 24 * 60 * 60 * 1000);
      const { error } = await admin.from('activities').insert({
        organization_id: orgId,
        type: 'task',
        title: action.title,
        description: summary,
        date: due.toISOString(),
        completed: false,
        deal_id: dealId,
        contact_id: contactId,
        owner_id: ctx.deal?.owner_id ?? ctx.conversation.assigned_owner_id ?? null,
      });
      if (error) throw new Error(error.message);
      return 'tarefa criada';
    }
    case 'handoff':
      result.handoffAgentId = action.agent_id;
      return 'passagem para outro agente solicitada';
    case 'approval':
      result.approvalAgentId = action.agent_id;
      return 'aprovação humana solicitada';
    case 'stop':
      result.stopped = true;
      return 'parada solicitada';
    default:
      return 'ação desconhecida ignorada';
  }
}

export async function executeOutcomeActions(
  admin: SupabaseClient,
  input: { agent: AgentRow; ctx: ConversationContext; outcome: Outcome; summary: string; runEvents: unknown[] }
): Promise<OutcomeActionsResult> {
  const result: OutcomeActionsResult = {};
  for (const action of input.outcome.actions ?? []) {
    const at = new Date().toISOString();
    try {
      const note = await runAction(admin, input, action, result);
      input.runEvents.push({ type: 'action', at, action: action.type, ok: true, note });
    } catch (e) {
      input.runEvents.push({ type: 'action', at, action: action.type, ok: false, error: errorMessage(e) });
    }
  }
  return result;
}
