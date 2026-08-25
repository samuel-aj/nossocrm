/**
 * Robôs de mensagens predefinidas (sem IA): execução passo a passo com
 * esperas, espera de resposta, condições por palavra-chave e entrega a um
 * agente de IA. Nada aqui lança: erros ficam na execução (status 'error').
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { moveStageByDealId } from '@/lib/public-api/dealsMoveStage';
import { normalizePhoneE164 } from '@/lib/phone';
import { getProvider, type SendResult } from '@/lib/whatsapp';
import {
  ensureConversation,
  getConnectionByIdForOrg,
  recordOutboundMessage,
  replicateOutboundToSiblings,
  type WaConnectionRow,
} from '@/lib/whatsapp/service';
import { addDealTag } from './actions';
import { isWaAgentsBetaEnabled } from './beta';
import { loadAgent, loadConversationContext, loadDealContext } from './context';
import { runAgentOnConversation } from './engine';
import { errorMessage } from './errors';
import { renderTemplate } from './template';
import { normalizeKeyword } from './text';
import { BotStepSchema, type BotLogEntry, type BotRow, type BotRunRow, type BotStep } from './types';
import { dispatchAgentEvent, postWebhook } from './webhooks';

export { normalizeKeyword };

const MAX_STEPS_PER_RUN = 50;
/** Limite absoluto de passos por execução (soma de todas as retomadas): evita laço infinito entre esperas. */
const MAX_STEPS_TOTAL = 500;
const BOT_LOCK_SECONDS = 120;
const TIMEOUT_STEP_VAR = '_timeout_step_id';
const STEPS_TOTAL_VAR = '_steps_total';
/** Modo quadro: marca que a execução já entrou pelo passo inicial (start_step_id) */
const STARTED_VAR = '_started';

function nowIso(): string {
  return new Date().toISOString();
}

function parseSteps(raw: unknown): BotStep[] {
  if (!Array.isArray(raw)) return [];
  const out: BotStep[] = [];
  for (const item of raw) {
    const p = BotStepSchema.safeParse(item);
    if (p.success) out.push(p.data);
  }
  return out;
}

function stepIndexById(steps: BotStep[], id: string | null | undefined): number {
  if (!id) return -1;
  return steps.findIndex(s => s.id === id);
}

/**
 * Índice do passo seguinte. Modo quadro (start_step_id definido): só navega
 * por `next_step_id`; destino ausente = fim (índice fora do array, que o laço
 * trata como 'done'). Modo lista (robôs antigos): índice + 1.
 */
export function nextStepIndex(steps: BotStep[], current: number, step: BotStep, canvas: boolean): number {
  if (!canvas) return current + 1;
  const target = stepIndexById(steps, step.next_step_id);
  return target >= 0 ? target : steps.length;
}

/** Variáveis públicas da execução (sem as internas, que começam com "_"). */
function publicVars(vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

/** Trava por execução: só uma instância mexe na run por vez. */
async function claimBotLock(admin: SupabaseClient, runId: string): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + BOT_LOCK_SECONDS * 1000).toISOString();
  const { data } = await admin
    .from('wa_bot_runs')
    .update({ lock_until: until })
    .eq('id', runId)
    .or(`lock_until.is.null,lock_until.lt.${now.toISOString()}`)
    .select('id')
    .maybeSingle();
  return !!data;
}

async function loadBot(admin: SupabaseClient, organizationId: string, botId: string): Promise<BotRow | null> {
  const { data } = await admin
    .from('wa_bots')
    .select('*')
    .eq('id', botId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  return (data as BotRow | null) ?? null;
}

type RunState = {
  run: BotRunRow;
  log: BotLogEntry[];
  vars: Record<string, unknown>;
};

/**
 * Grava a execução. `release: true` solta a trava (lock_until null): só nas
 * saídas terminais (done, error, cancelled) e nas paradas (wait, wait_reply);
 * gravações intermediárias mantêm a trava para outro tick não reprocessar.
 */
async function saveRun(
  admin: SupabaseClient,
  st: RunState,
  patch: Record<string, unknown>,
  opts: { release?: boolean } = {}
): Promise<void> {
  const { error } = await admin
    .from('wa_bot_runs')
    .update({
      ...patch,
      log: st.log,
      vars: st.vars,
      updated_at: nowIso(),
      ...(opts.release ? { lock_until: null } : {}),
    })
    .eq('id', st.run.id)
    .eq('organization_id', st.run.organization_id);
  if (error) console.error('[wa-agents] salvar execução do robô falhou:', error.message);
}

function note(st: RunState, step: BotStep | null, text: string): void {
  st.log.push({ at: nowIso(), step_id: step?.id ?? null, type: step?.type ?? 'run', note: text });
}

async function sendBotText(
  admin: SupabaseClient,
  st: RunState,
  connection: WaConnectionRow,
  phone: string,
  text: string
): Promise<void> {
  if (connection.status !== 'connected') throw new Error('número desconectado');
  const provider = getProvider(connection);
  let result: SendResult;
  try {
    result = await provider.sendText({ to: phone, text });
  } catch (e) {
    result = { ok: false, error: errorMessage(e) };
  }
  try {
    const msg = await recordOutboundMessage(admin, {
      orgId: st.run.organization_id,
      conversationId: st.run.conversation_id as string,
      text,
      providerMessageId: result.providerMessageId ?? null,
      fromPhone: connection.phone_number,
      toPhone: phone,
      sentBy: null,
      source: 'bot',
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error || 'falha no envio',
    });
    if (result.ok) {
      await replicateOutboundToSiblings(admin, connection, {
        toPhone: phone,
        text: msg.body,
        providerMessageId: result.providerMessageId ?? null,
      });
    }
  } catch (e) {
    console.error('[wa-agents] gravar mensagem do robô falhou:', errorMessage(e));
  }
  if (!result.ok) throw new Error(`envio falhou: ${result.error || 'erro desconhecido'}`);
}

/**
 * Processa uma execução a partir de `run.step_index`. Quem chama já deve ter
 * a trava (claimBotLock) ou ter acabado de criar a run.
 */
export async function processBotRun(admin: SupabaseClient, run: BotRunRow): Promise<void> {
  const st: RunState = {
    run,
    log: Array.isArray(run.log) ? ([...run.log] as BotLogEntry[]) : [],
    vars: { ...((run.vars ?? {}) as Record<string, unknown>) },
  };
  const orgId = run.organization_id;

  try {
    if (!(await isWaAgentsBetaEnabled(admin, orgId))) {
      note(st, null, 'versão beta desativada');
      await saveRun(admin, st, { status: 'cancelled', wake_at: null }, { release: true });
      return;
    }
    const bot = await loadBot(admin, orgId, run.bot_id);
    if (!bot || !bot.enabled) {
      note(st, null, bot ? 'robô desligado' : 'robô não encontrado');
      await saveRun(admin, st, { status: 'cancelled' }, { release: true });
      return;
    }
    const steps = parseSteps(bot.steps);
    if (steps.length === 0) {
      note(st, null, 'robô sem passos');
      await saveRun(admin, st, { status: 'done' }, { release: true });
      return;
    }

    // Negócio e contato
    const deal = await loadDealContext(admin, orgId, { dealId: run.deal_id });
    let contact: { id: string; name: string; phone: string | null } | null = null;
    let contactId = run.contact_id;
    if (!contactId && deal) {
      const { data } = await admin
        .from('deals')
        .select('contact_id')
        .eq('organization_id', orgId)
        .eq('id', deal.id)
        .maybeSingle();
      contactId = (data as { contact_id?: string | null } | null)?.contact_id ?? null;
    }
    if (contactId) {
      const { data } = await admin
        .from('contacts')
        .select('id, name, phone')
        .eq('organization_id', orgId)
        .eq('id', contactId)
        .maybeSingle();
      contact = (data as { id: string; name: string; phone: string | null } | null) ?? null;
    }

    // Conversa (cria na primeira execução)
    let connection: WaConnectionRow | null = null;
    let phone = run.phone ? normalizePhoneE164(run.phone) : '';
    if (!run.conversation_id) {
      phone = normalizePhoneE164(run.phone || contact?.phone || '');
      if (!phone) {
        note(st, null, 'sem telefone para enviar');
        await saveRun(admin, st, { status: 'error', error: 'sem telefone' }, { release: true });
        return;
      }
      if (!bot.connection_id) {
        note(st, null, 'robô sem número configurado');
        await saveRun(admin, st, { status: 'error', error: 'robô sem número' }, { release: true });
        return;
      }
      // O número precisa ser da organização antes de criar a conversa
      connection = await getConnectionByIdForOrg(admin, orgId, bot.connection_id);
      if (!connection) {
        note(st, null, 'número do robô não encontrado nesta organização');
        await saveRun(admin, st, { status: 'error', error: 'número do robô não encontrado' }, { release: true });
        return;
      }
      const conv = await ensureConversation(admin, orgId, bot.connection_id, phone, contact?.name ?? null);
      st.run = { ...st.run, conversation_id: conv.id, phone, contact_id: contact?.id ?? contactId ?? null };
      await saveRun(admin, st, { conversation_id: conv.id, phone, contact_id: st.run.contact_id });
    } else if (!phone) {
      const { data } = await admin
        .from('wa_conversations')
        .select('wa_phone')
        .eq('organization_id', orgId)
        .eq('id', run.conversation_id)
        .maybeSingle();
      phone = (data as { wa_phone?: string } | null)?.wa_phone ?? '';
      if (!phone) {
        note(st, null, 'conversa sem telefone');
        await saveRun(admin, st, { status: 'error', error: 'conversa sem telefone' }, { release: true });
        return;
      }
    }
    const conversationId = st.run.conversation_id as string;

    const getConnection = async (): Promise<WaConnectionRow> => {
      if (connection) return connection;
      if (!bot.connection_id) throw new Error('robô sem número configurado');
      connection = await getConnectionByIdForOrg(admin, orgId, bot.connection_id);
      if (!connection) throw new Error('número do robô não encontrado');
      return connection;
    };

    const nome = (contact?.name || '').trim();
    const tplVars: Record<string, unknown> = {
      nome,
      nome_lead: nome,
      primeiro_nome: nome.split(/\s+/)[0] ?? '',
      telefone: phone,
      negocio: { titulo: deal?.title ?? '', etapa: deal?.stage_label ?? '' },
    };

    // Modo quadro: começa no passo inicial e navega só por ids; modo lista: índice + 1
    const canvas = !!(bot.start_step_id && String(bot.start_step_id).trim());
    let idx = st.run.step_index ?? 0;
    if (canvas && st.vars[STARTED_VAR] !== true) {
      const startIdx = stepIndexById(steps, bot.start_step_id);
      if (startIdx < 0) {
        note(st, null, 'passo inicial não encontrado');
        await saveRun(admin, st, { status: 'error', error: 'passo inicial não encontrado', wake_at: null }, { release: true });
        return;
      }
      idx = startIdx;
      st.vars[STARTED_VAR] = true;
    }
    const next = (step: BotStep): number => nextStepIndex(steps, idx, step, canvas);

    for (let guard = 0; guard < MAX_STEPS_PER_RUN; guard++) {
      const step = steps[idx];
      if (!step) {
        note(st, null, 'fim dos passos');
        await saveRun(admin, st, { status: 'done', step_index: idx, wake_at: null }, { release: true });
        return;
      }

      // Contador persistente (sobrevive a wait/wait_reply): laço infinito vira erro
      const prevTotal = Number(st.vars[STEPS_TOTAL_VAR]);
      const stepsTotal = (Number.isFinite(prevTotal) ? prevTotal : 0) + 1;
      st.vars[STEPS_TOTAL_VAR] = stepsTotal;
      if (stepsTotal > MAX_STEPS_TOTAL) {
        note(st, step, 'limite de passos atingido');
        await saveRun(
          admin,
          st,
          { status: 'error', step_index: idx, wake_at: null, error: 'limite de passos atingido' },
          { release: true }
        );
        return;
      }

      switch (step.type) {
        case 'send_text': {
          const text = renderTemplate(step.text, tplVars).trim();
          if (text) {
            await sendBotText(admin, st, await getConnection(), phone, text);
            note(st, step, `mensagem enviada: ${text.slice(0, 80)}`);
          } else {
            note(st, step, 'mensagem vazia ignorada');
          }
          idx = next(step);
          break;
        }
        case 'wait': {
          const wakeAt = new Date(Date.now() + step.seconds * 1000).toISOString();
          note(st, step, `esperando ${step.seconds}s`);
          await saveRun(admin, st, { status: 'running', step_index: next(step), wake_at: wakeAt }, { release: true });
          return;
        }
        case 'wait_reply': {
          const wakeAt = new Date(Date.now() + step.timeout_minutes * 60 * 1000).toISOString();
          st.vars[TIMEOUT_STEP_VAR] = step.on_timeout_step_id ?? null;
          note(st, step, `esperando resposta por até ${step.timeout_minutes} min`);
          await saveRun(
            admin,
            st,
            { status: 'waiting_reply', step_index: next(step), wake_at: wakeAt },
            { release: true }
          );
          return;
        }
        case 'condition': {
          const reply = normalizeKeyword(String(st.vars.last_reply ?? ''));
          let target = -1;
          let matched: string | null = null;
          for (const rule of step.rules) {
            const hit = rule.keywords.find(k => {
              const kw = normalizeKeyword(k);
              return kw.length > 0 && reply.includes(kw);
            });
            if (hit) {
              matched = hit;
              target = stepIndexById(steps, rule.goto_step_id);
              break;
            }
          }
          if (matched) {
            if (target < 0) throw new Error(`passo de destino não encontrado para "${matched}"`);
            note(st, step, `"${matched}" encontrado, indo para o passo ${steps[target].id}`);
            idx = target;
          } else if (step.else_step_id) {
            const elseIdx = stepIndexById(steps, step.else_step_id);
            if (elseIdx < 0) throw new Error('passo "senão" não encontrado');
            note(st, step, `sem correspondência, indo para o passo ${steps[elseIdx].id}`);
            idx = elseIdx;
          } else if (canvas) {
            note(st, step, 'sem correspondência e sem "senão": encerrando');
            idx = steps.length;
          } else {
            note(st, step, 'sem correspondência, seguindo para o próximo passo');
            idx++;
          }
          break;
        }
        case 'move_stage': {
          if (!deal) {
            note(st, step, 'sem negócio: etapa ignorada');
          } else {
            const r = await moveStageByDealId({ organizationId: orgId, dealId: deal.id, target: { to_stage_id: step.stage_id } });
            if (!r.ok) throw new Error((r.body as { error?: string }).error || 'falha ao mover etapa');
            note(st, step, 'negócio movido de etapa');
          }
          idx = next(step);
          break;
        }
        case 'add_tag': {
          if (!deal) {
            note(st, step, 'sem negócio: rótulo ignorado');
          } else {
            await addDealTag(admin, orgId, deal.id, step.tag);
            note(st, step, `rótulo "${step.tag}" adicionado`);
          }
          idx = next(step);
          break;
        }
        case 'webhook': {
          // Mesmo POST dos webhooks do agente; falha não derruba o robô (fica no log)
          const r = await postWebhook({
            url: step.url,
            event: 'bot_webhook',
            secret: step.secret,
            body_template: step.body_template,
            payload: {
              event: 'bot_webhook',
              occurred_at: nowIso(),
              organization_id: orgId,
              bot: { id: bot.id, name: bot.name },
              run: { id: st.run.id, step_id: step.id },
              conversation: {
                id: conversationId,
                phone,
                name: contact?.name ?? null,
                contact_id: contact?.id ?? contactId ?? null,
                deal_id: deal?.id ?? null,
              },
              contact,
              deal,
              last_reply: st.vars.last_reply ?? null,
              vars: publicVars(st.vars),
            },
          });
          note(st, step, r.ok ? `webhook enviado (HTTP ${r.status ?? '?'})` : `webhook falhou: ${r.error ?? 'erro desconhecido'}`);
          idx = next(step);
          break;
        }
        case 'handoff_agent': {
          const agent = await loadAgent(admin, orgId, step.agent_id);
          if (!agent) throw new Error('agente de destino não encontrado');
          if (!agent.enabled) throw new Error('agente de destino desligado');
          const now = nowIso();
          const { error } = await admin
            .from('wa_conversations')
            .update({
              ai_agent_id: agent.id,
              ai_status: 'active',
              ai_status_changed_at: now,
              ai_state: {},
              ai_approval: null,
              ai_resume_at: null,
              ai_paused_by: null,
              ai_last_processed_at: null,
            })
            .eq('id', conversationId)
            .eq('organization_id', orgId);
          if (error) throw new Error(error.message);
          note(st, step, `entregue ao agente ${agent.name}`);
          await saveRun(admin, st, { status: 'done', step_index: idx + 1, wake_at: null }, { release: true });
          try {
            const ctx = await loadConversationContext(admin, orgId, conversationId);
            await dispatchAgentEvent(admin, { agent, event: 'started', ctx, extra: { by: 'bot', bot_id: bot.id } });
          } catch (e) {
            console.error('[wa-agents] webhook de início pelo robô falhou:', errorMessage(e));
          }
          await runAgentOnConversation({
            organizationId: orgId,
            conversationId,
            trigger: 'bot',
            agentId: agent.id,
            forceReply: true,
            skipBuffer: true,
          });
          return;
        }
        case 'end': {
          note(st, step, 'encerrado');
          await saveRun(admin, st, { status: 'done', step_index: idx, wake_at: null }, { release: true });
          return;
        }
        default: {
          note(st, step, 'tipo de passo desconhecido, ignorado');
          idx = next(step);
        }
      }
    }
    note(st, null, 'limite de passos por execução atingido');
    await saveRun(admin, st, { status: 'error', step_index: idx, error: 'limite de passos' }, { release: true });
  } catch (e) {
    const msg = errorMessage(e);
    console.error('[wa-agents] robô falhou:', msg);
    note(st, null, `erro: ${msg}`);
    await saveRun(admin, st, { status: 'error', error: msg, wake_at: null }, { release: true });
  }
}

/** Resposta do lead numa execução em 'waiting_reply'. */
export async function handleBotReply(
  admin: SupabaseClient,
  input: { run: BotRunRow; message: { id: string; body: string | null; transcription: string | null } }
): Promise<void> {
  const { run, message } = input;
  try {
    const lastReply = (message.body ?? '').trim() || (message.transcription ?? '').trim() || '';
    const vars = { ...((run.vars ?? {}) as Record<string, unknown>), last_reply: lastReply, last_reply_message_id: message.id };
    // Primeiro o update condicional; a trava só depois (não fica presa se outra instância já cuidou)
    const { data } = await admin
      .from('wa_bot_runs')
      .update({ vars, status: 'running', wake_at: nowIso(), updated_at: nowIso() })
      .eq('id', run.id)
      .eq('organization_id', run.organization_id)
      .eq('status', 'waiting_reply')
      .select('*')
      .maybeSingle();
    if (!data) return; // outra instância já cuidou
    // Sem a trava, o relógio (tick) pega a execução em 'running' com wake_at vencido
    const locked = await claimBotLock(admin, run.id);
    if (!locked) return;
    await processBotRun(admin, data as BotRunRow);
  } catch (e) {
    console.error('[wa-agents] resposta ao robô falhou:', errorMessage(e));
  }
}

/** Tempo de espera de resposta esgotado. */
async function handleBotTimeout(admin: SupabaseClient, run: BotRunRow): Promise<void> {
  const st: RunState = {
    run,
    log: Array.isArray(run.log) ? ([...run.log] as BotLogEntry[]) : [],
    vars: { ...((run.vars ?? {}) as Record<string, unknown>) },
  };
  const bot = await loadBot(admin, run.organization_id, run.bot_id);
  const steps = bot ? parseSteps(bot.steps) : [];
  let timeoutStepId = (st.vars[TIMEOUT_STEP_VAR] as string | null | undefined) ?? null;
  if (!timeoutStepId && !bot?.start_step_id) {
    // Modo lista: o passo anterior ao índice salvo é o wait_reply
    const prev = steps[run.step_index - 1];
    if (prev && prev.type === 'wait_reply') timeoutStepId = prev.on_timeout_step_id ?? null;
  }
  const target = stepIndexById(steps, timeoutStepId);
  if (target >= 0) {
    note(st, null, `sem resposta, indo para o passo ${steps[target].id}`);
    delete st.vars[TIMEOUT_STEP_VAR];
    await saveRun(admin, st, { status: 'running', step_index: target, wake_at: nowIso() });
    await processBotRun(admin, { ...run, status: 'running', step_index: target, log: st.log, vars: st.vars });
    return;
  }
  note(st, null, 'sem resposta');
  await saveRun(admin, st, { status: 'done', wake_at: null }, { release: true });
}

export async function processDueBotRuns(
  admin: SupabaseClient,
  opts: { limit?: number; deadlineMs?: number } = {}
): Promise<{ processed: number }> {
  const limit = opts.limit ?? 25;
  let processed = 0;
  try {
    const { data } = await admin
      .from('wa_bot_runs')
      .select('*')
      .in('status', ['running', 'waiting_reply'])
      .not('wake_at', 'is', null)
      .lte('wake_at', nowIso())
      .order('wake_at', { ascending: true })
      .limit(limit);

    for (const raw of (data ?? []) as BotRunRow[]) {
      // Orçamento de tempo do tick: o que sobrar fica para o próximo
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
      try {
        const locked = await claimBotLock(admin, raw.id);
        if (!locked) continue;
        if (raw.status === 'waiting_reply') await handleBotTimeout(admin, raw);
        else await processBotRun(admin, raw);
        processed++;
      } catch (e) {
        const msg = errorMessage(e);
        console.error('[wa-agents] execução do robô falhou:', msg);
        await admin
          .from('wa_bot_runs')
          .update({ status: 'error', error: msg, lock_until: null, updated_at: nowIso() })
          .eq('id', raw.id);
      }
    }
  } catch (e) {
    console.error('[wa-agents] busca de robôs pendentes falhou:', errorMessage(e));
  }
  return { processed };
}

export type StartBotRunInput = {
  organizationId: string;
  botId: string;
  dealId?: string | null;
  contactId?: string | null;
  phone?: string | null;
};

/** Só cria a execução (status 'running', wake_at agora), sem processar. */
export async function createBotRun(
  admin: SupabaseClient,
  input: StartBotRunInput
): Promise<{ ok: boolean; run?: BotRunRow; error?: string }> {
  try {
    const bot = await loadBot(admin, input.organizationId, input.botId);
    if (!bot) return { ok: false, error: 'Robô não encontrado' };
    if (!bot.enabled) return { ok: false, error: 'Robô desligado' };
    const phone = input.phone ? normalizePhoneE164(input.phone) : null;
    if (!input.dealId && !input.contactId && !phone) {
      return { ok: false, error: 'Informe um negócio, um contato ou um telefone' };
    }
    const { data, error } = await admin
      .from('wa_bot_runs')
      .insert({
        organization_id: input.organizationId,
        bot_id: bot.id,
        deal_id: input.dealId ?? null,
        contact_id: input.contactId ?? null,
        phone: phone || null,
        status: 'running',
        wake_at: nowIso(),
        step_index: 0,
        vars: {},
        log: [],
      })
      .select('*')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, run: data as BotRunRow };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Pega a trava e processa a execução agora (sem a trava, o tick cuida). */
export async function runBotRunNow(admin: SupabaseClient, run: BotRunRow): Promise<void> {
  const locked = await claimBotLock(admin, run.id);
  if (locked) await processBotRun(admin, run);
}

/** Cria a execução e, por padrão, processa na hora (`process: false` só cria). */
export async function startBotRun(
  admin: SupabaseClient,
  input: StartBotRunInput,
  opts: { process?: boolean } = {}
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  try {
    const created = await createBotRun(admin, input);
    if (!created.ok || !created.run) return { ok: false, error: created.error };
    if (opts.process !== false) await runBotRunNow(admin, created.run);
    return { ok: true, runId: created.run.id };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
