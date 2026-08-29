/**
 * Esteira de ações: executa as ações de um resultado do encerramento ou de
 * uma ação durante a conversa (nota, etapa, rótulo, perdido, responsável,
 * tarefa, webhook). handoff/approval/stop só são devolvidos: quem aplica é o
 * motor.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { moveStageByDealId } from '@/lib/public-api/dealsMoveStage';
import type { ConversationContext } from './context';
import { errorMessage } from './errors';
import type { AgentRow, CustomAction, EndAction, Outcome } from './types';
import { buildWebhookPayload, postWebhook } from './webhooks';

export type OutcomeActionsResult = { handoffAgentId?: string; approvalAgentId?: string; stopped?: boolean };

/**
 * De onde vêm as ações: resultado do encerramento (resumo) ou ação durante a
 * conversa (detalhes). Muda o título padrão da nota e o payload do webhook.
 */
export type ActionSource =
  | { kind: 'outcome'; outcome: Outcome; summary: string }
  | { kind: 'custom'; action: CustomAction; details: string };

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

/** true se o usuário é da organização (perfil na org ou vínculo em user_organizations). */
async function ownerBelongsToOrg(admin: SupabaseClient, organizationId: string, ownerId: string): Promise<boolean> {
  const [{ data: profiles }, { data: members }] = await Promise.all([
    admin.from('profiles').select('id').eq('organization_id', organizationId).eq('id', ownerId).limit(1),
    admin.from('user_organizations').select('user_id').eq('organization_id', organizationId).eq('user_id', ownerId).limit(1),
  ]);
  return (profiles ?? []).length > 0 || (members ?? []).length > 0;
}

function sourceSummary(source: ActionSource): string {
  return source.kind === 'outcome' ? source.summary : source.details;
}

function sourceNoteTitle(source: ActionSource): string {
  return source.kind === 'outcome'
    ? `Pré-atendimento IA: ${source.outcome.label}`
    : `Ação do agente de IA: ${source.action.label}`;
}

/** Campos extras do payload do webhook: resultado/resumo ou acao/detalhes. */
function sourcePayloadExtra(source: ActionSource): Record<string, unknown> {
  return source.kind === 'outcome'
    ? { resultado: source.outcome.key, resultado_label: source.outcome.label, resumo: source.summary }
    : { acao: source.action.key, acao_label: source.action.label, detalhes: source.details };
}

async function runAction(
  admin: SupabaseClient,
  input: { agent: AgentRow; ctx: ConversationContext; source: ActionSource },
  action: EndAction,
  result: OutcomeActionsResult
): Promise<string> {
  const { agent, ctx, source } = input;
  const orgId = ctx.conversation.organization_id;
  const dealId = ctx.deal?.id ?? null;
  const contactId = ctx.contact?.id ?? ctx.conversation.contact_id ?? null;
  const summary = sourceSummary(source);
  const now = new Date();

  switch (action.type) {
    case 'note': {
      const { error } = await admin.from('activities').insert({
        organization_id: orgId,
        type: 'note',
        title: action.title?.trim() || sourceNoteTitle(source),
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
    case 'append_description': {
      if (!dealId) return 'sem negócio: descrição ignorada';
      const texto = summary.trim();
      if (!texto) return 'sem resumo: descrição ignorada';
      const prefixo = action.prefix?.trim();
      const trecho = prefixo ? `${prefixo}\n${texto}` : texto;
      const { data: atual } = await admin
        .from('deals')
        .select('description')
        .eq('organization_id', orgId)
        .eq('id', dealId)
        .maybeSingle();
      // Mesma regra da API pública (PATCH /deals description_append): anexa numa linha nova
      const anterior = typeof (atual as { description?: string | null } | null)?.description === 'string'
        ? ((atual as { description: string }).description ?? '').trim()
        : '';
      const { error } = await admin
        .from('deals')
        .update({ description: anterior ? `${anterior}\n${trecho}` : trecho, updated_at: now.toISOString() })
        .eq('organization_id', orgId)
        .eq('id', dealId);
      if (error) throw new Error(error.message);
      return 'descrição do negócio atualizada';
    }
    case 'set_product': {
      if (!dealId) return 'sem negócio: produto ignorado';
      const { data: product } = await admin
        .from('products')
        .select('id, name, price')
        .eq('organization_id', orgId)
        .eq('id', action.product_id)
        .maybeSingle();
      const prod = product as { id: string; name: string; price: number | null } | null;
      if (!prod) throw new Error('produto não encontrado nesta organização');
      // Idempotente: o mesmo produto não entra duas vezes no negócio
      const { data: existing } = await admin
        .from('deal_items')
        .select('id')
        .eq('organization_id', orgId)
        .eq('deal_id', dealId)
        .eq('product_id', prod.id)
        .limit(1);
      if ((existing ?? []).length > 0) return `produto "${prod.name}" já estava no negócio`;
      const { error } = await admin.from('deal_items').insert({
        organization_id: orgId,
        deal_id: dealId,
        product_id: prod.id,
        name: prod.name,
        quantity: 1,
        price: prod.price ?? 0,
      });
      if (error) throw new Error(error.message);
      return `produto "${prod.name}" lançado no negócio`;
    }
    case 'assign_owner': {
      if (!(await ownerBelongsToOrg(admin, orgId, action.owner_id))) {
        throw new Error('responsável não pertence à organização');
      }
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
    case 'webhook': {
      // Mesmo formato dos webhooks por evento; nunca lança (o resultado vai para o registro)
      const event = source.kind === 'outcome' ? 'outcome_action' : 'custom_action';
      const payload = buildWebhookPayload({ agent, event, ctx, extra: sourcePayloadExtra(source) });
      const r = await postWebhook({
        url: action.url,
        event,
        payload,
        secret: action.secret,
        body_template: action.body_template,
      });
      if (!r.ok) throw new Error(`webhook falhou: ${r.error || 'erro desconhecido'}`);
      return `webhook enviado (HTTP ${r.status ?? '?'})`;
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

/**
 * Executa uma lista de ações em ordem. Erros por ação são capturados e
 * registrados em runEvents, sem abortar as demais.
 */
export async function executeActions(
  admin: SupabaseClient,
  input: {
    agent: AgentRow;
    ctx: ConversationContext;
    actions: EndAction[];
    source: ActionSource;
    runEvents: unknown[];
    /** Renova a trava da conversa antes de cada ação (webhooks podem demorar) */
    renewLock?: () => Promise<void>;
  }
): Promise<OutcomeActionsResult> {
  const result: OutcomeActionsResult = {};
  const origin =
    input.source.kind === 'outcome'
      ? { source: 'outcome', key: input.source.outcome.key }
      : { source: 'custom_action', key: input.source.action.key };
  for (const action of input.actions ?? []) {
    const at = new Date().toISOString();
    if (input.renewLock) await input.renewLock();
    try {
      const note = await runAction(admin, input, action, result);
      input.runEvents.push({ type: 'action', at, action: action.type, ok: true, note, ...origin });
    } catch (e) {
      input.runEvents.push({ type: 'action', at, action: action.type, ok: false, error: errorMessage(e), ...origin });
    }
  }
  return result;
}

/** Ações de um resultado do encerramento. */
export async function executeOutcomeActions(
  admin: SupabaseClient,
  input: {
    agent: AgentRow;
    ctx: ConversationContext;
    outcome: Outcome;
    summary: string;
    runEvents: unknown[];
    renewLock?: () => Promise<void>;
  }
): Promise<OutcomeActionsResult> {
  return executeActions(admin, {
    agent: input.agent,
    ctx: input.ctx,
    actions: input.outcome.actions ?? [],
    source: { kind: 'outcome', outcome: input.outcome, summary: input.summary },
    runEvents: input.runEvents,
    renewLock: input.renewLock,
  });
}

/** Ações de uma ação durante a conversa (ferramenta executar_acao). */
export async function executeCustomAction(
  admin: SupabaseClient,
  input: {
    agent: AgentRow;
    ctx: ConversationContext;
    action: CustomAction;
    details: string;
    runEvents: unknown[];
    renewLock?: () => Promise<void>;
  }
): Promise<OutcomeActionsResult> {
  return executeActions(admin, {
    agent: input.agent,
    ctx: input.ctx,
    actions: input.action.actions ?? [],
    source: { kind: 'custom', action: input.action, details: input.details },
    runEvents: input.runEvents,
    renewLock: input.renewLock,
  });
}
