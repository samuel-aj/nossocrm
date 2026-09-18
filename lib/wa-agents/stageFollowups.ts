/**
 * Follow-up por inatividade do lead em cada etapa: execução.
 *
 * O AGENDAMENTO é todo do banco (migração 20260918120000): entrar na etapa,
 * mensagem do lead, ganho/perda/exclusão e mudança da regra recalculam
 * deal_followup_schedules. Aqui só se executa o que venceu, pegando cada item
 * com `stage_followup_claim` (dois processos nunca pegam o mesmo) e conferindo
 * TUDO de novo antes de agir: etapa, situação do lead, regra e se o lead não
 * escreveu nesse meio tempo. O resultado grava exatamente o que aconteceu
 * (robô iniciado, mensagem enviada, pulado ou falhou), nunca "enviado" só
 * porque entrou na fila. SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceWindow } from '@/lib/whatsapp/serviceWindow';
import { getConnectionByIdForOrg, type WaConnectionRow } from '@/lib/whatsapp/service';
import { sendTemplateToConversation, sendTextToConversation, startBotRun } from './bots';
import { loadDealContext } from './context';
import { errorMessage } from './errors';
import { renderTemplate } from './template';

export type FollowupSchedule = {
  deal_id: string;
  organization_id: string;
  stage_id: string;
  rule_version: number;
  entered_at: string;
  anchor_at: string;
  due_at: string;
  status: string;
  attempts: number;
};

export type FollowupRule = {
  stage_id: string;
  organization_id: string;
  enabled: boolean;
  delay_seconds: number;
  action_type: 'bot' | 'message';
  bot_id: string | null;
  message: { kind?: 'text' | 'template'; text?: string; template_id?: string } | null;
  version: number;
};

type Outcome =
  | { status: 'done'; result: Record<string, unknown> }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }
  | { status: 'cancelled'; reason: string }
  /** Lead respondeu depois de o item ser pego: o banco já reagendou, nada a gravar */
  | { status: 'superseded' };

type Conv = {
  id: string;
  connection_id: string | null;
  wa_phone: string | null;
  deal_id: string | null;
  contact_id: string | null;
  last_message_at: string | null;
};

/** Mensagem recebida do lead mais recente nas conversas do negócio (ou do contato). */
async function lastInboundAt(admin: SupabaseClient, convIds: string[]): Promise<string | null> {
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

/**
 * Decide o que fazer com UM agendamento vencido. Separado da gravação para ser
 * testado sem banco de verdade.
 */
export async function runStageFollowup(admin: SupabaseClient, s: FollowupSchedule): Promise<Outcome> {
  const orgId = s.organization_id;

  const { data: ruleRow } = await admin
    .from('stage_followup_rules')
    .select('stage_id, organization_id, enabled, delay_seconds, action_type, bot_id, message, version')
    .eq('stage_id', s.stage_id)
    .maybeSingle();
  const rule = ruleRow as FollowupRule | null;
  if (!rule || !rule.enabled) return { status: 'cancelled', reason: 'regra desligada ou apagada' };

  const { data: dealRow } = await admin
    .from('deals')
    .select('id, organization_id, stage_id, contact_id, is_won, is_lost, deleted_at')
    .eq('id', s.deal_id)
    .maybeSingle();
  const deal = dealRow as {
    id: string;
    organization_id: string;
    stage_id: string | null;
    contact_id: string | null;
    is_won: boolean | null;
    is_lost: boolean | null;
    deleted_at: string | null;
  } | null;
  if (!deal || deal.organization_id !== orgId || deal.deleted_at) return { status: 'cancelled', reason: 'lead excluído' };
  if (deal.is_won || deal.is_lost) return { status: 'cancelled', reason: 'lead ganho ou perdido' };
  if (deal.stage_id !== s.stage_id) return { status: 'cancelled', reason: 'lead mudou de etapa' };

  // UMA vez por etapa para cada lead (o banco também garante; aqui é a rechecagem)
  const { data: fired } = await admin
    .from('deal_followup_fires')
    .select('deal_id')
    .eq('deal_id', s.deal_id)
    .eq('stage_id', s.stage_id)
    .limit(1);
  if ((fired ?? []).length > 0) return { status: 'cancelled', reason: 'o follow-up desta etapa já foi executado para este lead' };

  // Conversas do negócio: as ligadas a ele; sem nenhuma, as do contato
  let convQuery = admin
    .from('wa_conversations')
    .select('id, connection_id, wa_phone, deal_id, contact_id, last_message_at, is_group')
    .eq('organization_id', orgId);
  convQuery = deal.contact_id ? convQuery.or(`deal_id.eq.${deal.id},contact_id.eq.${deal.contact_id}`) : convQuery.eq('deal_id', deal.id);
  const { data: convRows } = await convQuery;
  const convs = ((convRows ?? []) as Array<Conv & { is_group?: boolean | null }>).filter((c) => !c.is_group);

  // Última palavra do lead: se ele escreveu depois do início da contagem, o
  // banco já reagendou; não age com a informação velha
  const lastIn = await lastInboundAt(admin, convs.map((c) => c.id));
  if (lastIn && Date.parse(lastIn) > Date.parse(s.anchor_at) + 1) return { status: 'superseded' };

  const newest = (list: Conv[]) =>
    [...list].sort((a, b) => Date.parse(b.last_message_at ?? '0') - Date.parse(a.last_message_at ?? '0'))[0] ?? null;
  const linked = convs.filter((c) => c.deal_id === deal.id);
  let conv: Conv | null = newest(linked);
  if (!conv && convs.length > 0) {
    // Sem conversa ligada ao lead: só usa a do contato se ele não tiver OUTRO lead aberto
    // (senão o follow-up de um lead cairia na conversa de outro)
    const { count } = await admin
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('contact_id', deal.contact_id as string)
      .is('deleted_at', null)
      .eq('is_won', false)
      .eq('is_lost', false);
    if ((count ?? 0) > 1) {
      return { status: 'skipped', reason: 'o contato tem mais de um lead aberto e nenhuma conversa ligada a este lead' };
    }
    conv = newest(convs);
  }

  if (rule.action_type === 'bot') {
    if (!rule.bot_id) return { status: 'failed', error: 'regra sem robô escolhido' };
    // Mesmo robô já rodando neste lead/conversa: não abre outra instância
    let activeQuery = admin
      .from('wa_bot_runs')
      .select('id')
      .eq('organization_id', orgId)
      .eq('bot_id', rule.bot_id)
      .in('status', ['running', 'waiting_reply']);
    activeQuery = conv ? activeQuery.or(`deal_id.eq.${deal.id},conversation_id.eq.${conv.id}`) : activeQuery.eq('deal_id', deal.id);
    const { data: active } = await activeQuery.limit(1);
    if ((active ?? []).length > 0) return { status: 'skipped', reason: 'o robô já está em andamento neste lead' };
    const started = await startBotRun(admin, {
      organizationId: orgId,
      botId: rule.bot_id,
      dealId: deal.id,
      contactId: deal.contact_id,
      conversationId: conv?.id ?? null,
    });
    if (!started.ok || !started.runId) return { status: 'failed', error: started.error || 'o robô não iniciou' };
    return { status: 'done', result: { kind: 'bot_started', bot_id: rule.bot_id, run_id: started.runId } };
  }

  // Mensagem
  if (!conv) return { status: 'failed', error: 'o lead não tem conversa no WhatsApp' };
  if (!conv.connection_id) return { status: 'failed', error: 'a conversa não tem número conectado' };
  const phone = (conv.wa_phone ?? '').trim();
  if (!phone) return { status: 'failed', error: 'a conversa não tem telefone' };
  const connection = (await getConnectionByIdForOrg(admin, orgId, conv.connection_id)) as WaConnectionRow | null;
  if (!connection) return { status: 'failed', error: 'o número da conversa não existe mais' };
  if (connection.status !== 'connected') return { status: 'failed', error: 'o número da conversa está desconectado' };

  const msg = rule.message ?? {};
  const ctxDeal = await loadDealContext(admin, orgId, { dealId: deal.id });
  let contactName = '';
  if (deal.contact_id) {
    const { data: c } = await admin.from('contacts').select('name').eq('id', deal.contact_id).maybeSingle();
    contactName = ((c as { name?: string } | null)?.name ?? '').trim();
  }

  if (msg.kind === 'template') {
    if (!msg.template_id) return { status: 'failed', error: 'regra sem modelo escolhido' };
    const name = await sendTemplateToConversation(admin, {
      organizationId: orgId,
      conversationId: conv.id,
      connection,
      phone,
      templateId: msg.template_id,
      values: {
        'contato.nome': contactName,
        'contato.telefone': phone,
        'lead.titulo': ctxDeal?.title ?? '',
        'lead.etapa': ctxDeal?.stage_label ?? '',
      },
    });
    return { status: 'done', result: { kind: 'message_sent', template: name, conversation_id: conv.id } };
  }

  const text = renderTemplate(String(msg.text ?? ''), {
    nome: contactName,
    primeiro_nome: contactName.split(/\s+/)[0] ?? '',
    telefone: phone,
    negocio: { titulo: ctxDeal?.title ?? '', etapa: ctxDeal?.stage_label ?? '' },
  }).trim();
  if (!text) return { status: 'failed', error: 'a mensagem está vazia' };
  // API oficial da Meta: texto livre só dentro de 24 h da última mensagem do lead
  if (connection.provider === 'meta_cloud' && !getServiceWindow(lastIn).open) {
    return { status: 'failed', error: 'janela de 24 h fechada na API oficial: use um modelo de mensagem aprovado' };
  }
  await sendTextToConversation(admin, { organizationId: orgId, conversationId: conv.id, connection, phone, text });
  return { status: 'done', result: { kind: 'message_sent', text: text.slice(0, 200), conversation_id: conv.id } };
}

/** Grava o resultado (só se o item ainda for o mesmo que foi pego) e o registra no histórico do lead. */
async function finish(admin: SupabaseClient, s: FollowupSchedule, outcome: Outcome): Promise<void> {
  if (outcome.status === 'superseded') return;
  const now = new Date().toISOString();
  const result =
    outcome.status === 'done'
      ? outcome.result
      : outcome.status === 'failed'
        ? { error: outcome.error }
        : { reason: outcome.reason };
  const { data } = await admin
    .from('deal_followup_schedules')
    .update({
      status: outcome.status,
      lock_until: null,
      last_result: result,
      ...(outcome.status === 'done' || outcome.status === 'failed' ? { fired_at: now } : {}),
      updated_at: now,
    })
    .eq('deal_id', s.deal_id)
    .eq('status', 'processing')
    .eq('anchor_at', s.anchor_at)
    .select('deal_id');
  // Cancelado por mudança de etapa/regra não vai ao histórico (a própria mudança já aparece lá)
  if ((data ?? []).length === 0 || outcome.status === 'cancelled') return;
  await admin.from('deal_events').insert({
    organization_id: s.organization_id,
    deal_id: s.deal_id,
    kind: 'followup',
    new_value: outcome.status,
    detail: { stage_id: s.stage_id, anchor_at: s.anchor_at, ...result },
    actor_kind: 'system',
  });
}

/** Tick: executa os follow-ups vencidos (poucos por vez, com orçamento de tempo). */
export async function processStageFollowups(
  admin: SupabaseClient,
  opts: { limit?: number; deadlineMs?: number } = {}
): Promise<{ processed: number }> {
  let processed = 0;
  const { data, error } = await admin.rpc('stage_followup_claim', { p_limit: opts.limit ?? 10 });
  if (error) {
    // Migração ainda não aplicada: silêncio (nada agendado ainda)
    if (!/stage_followup_claim|does not exist|PGRST202/i.test(error.message)) {
      console.error('[followup-etapa] pegar vencidos falhou:', error.message);
    }
    return { processed };
  }
  for (const s of (data ?? []) as FollowupSchedule[]) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    let outcome: Outcome;
    try {
      // Pego de novo depois de o servidor cair no meio várias vezes: para de tentar
      outcome = s.attempts > 3 ? { status: 'failed', error: 'tentativas esgotadas' } : await runStageFollowup(admin, s);
    } catch (e) {
      outcome = { status: 'failed', error: errorMessage(e) };
    }
    try {
      await finish(admin, s, outcome);
    } catch (e) {
      console.error('[followup-etapa] gravar resultado falhou:', errorMessage(e));
    }
    processed++;
  }
  return { processed };
}
