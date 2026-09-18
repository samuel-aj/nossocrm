/**
 * Robôs de mensagens predefinidas (sem IA): execução passo a passo com
 * esperas, espera de resposta, condições por palavra-chave e entrega a um
 * agente de IA. Nada aqui lança: erros ficam na execução (status 'error').
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { moveStageByDealId } from '@/lib/public-api/dealsMoveStage';
import { fillTemplate, templateParams } from '@/lib/messageTemplates';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';
import { getProvider, type SendResult } from '@/lib/whatsapp';
import {
  ensureConversation,
  getConnectionByIdForOrg,
  recordOutboundMessage,
  replicateOutboundToSiblings,
  type WaConnectionRow,
} from '@/lib/whatsapp/service';
import { addDealTag } from './actions';
import { applyLeadChanges, ensureLeadForContact, recordLossHistory, removeDealTag } from './leadOps';
import { isAiAgentsApproved } from './beta';
import { loadAgent, loadConversationContext, loadDealContext, loadLastInboundProviderId } from './context';
import { runAgentOnConversation } from './engine';
import { errorMessage } from './errors';
import { renderTemplate } from './template';
import { normalizeKeyword } from './text';
import {
  BotStepSchema,
  type BotConditionClause,
  type BotConditionRule,
  type BotLogEntry,
  type BotRow,
  type BotRunRow,
  type BotStep,
} from './types';
import { dispatchAgentEvent, postWebhook } from './webhooks';
import { withActor } from '@/lib/supabase/actorClient';

export { normalizeKeyword };

const MAX_STEPS_PER_RUN = 50;
/** Limite absoluto de passos por execução (soma de todas as retomadas): evita laço infinito entre esperas. */
const MAX_STEPS_TOTAL = 500;
const BOT_LOCK_SECONDS = 120;
const TIMEOUT_STEP_VAR = '_timeout_step_id';
const STEPS_TOTAL_VAR = '_steps_total';
/** Execução parada num Modelo de mensagem esperando a resposta: ao voltar, o passo roteia (botão/outra resposta) em vez de reenviar */
const TEMPLATE_ROUTE_VAR = '_template_route_step_id';
/** Robô iniciado por outro robô: profundidade da cadeia (evita A → B → A sem fim) */
const CHAIN_DEPTH_VAR = '_chain_depth';
const MAX_CHAIN_DEPTH = 5;
/** Esperas de até isto acontecem dentro da execução (o relógio do tick é de 30 s e atrasaria) */
const INLINE_WAIT_MAX_S = 25;
/** Passo onde a execução parou (wait/wait_reply): retomar pelo id, porque editar o quadro reordena o array */
const RESUME_STEP_VAR = '_resume_step_id';
/**
 * Passos de CRM: falha registra no histórico e o fluxo SEGUE (decisão do produto).
 * Mensagem que não sai, espera e transferências continuam parando a execução.
 */
const CONTINUE_ON_FAILURE = new Set<BotStep['type']>(['move_stage', 'add_tag', 'remove_tag', 'create_lead', 'update_lead', 'webhook']);
/** Mensagem cujo "digitando..." já rodou (retomada depois de uma digitação longa não repete) */
const TYPED_STEP_VAR = '_typed_step_id';
/** Passos que falam com o lead: exigem conversa no WhatsApp (telefone + número). */
const CONVERSATION_STEP_TYPES = new Set<BotStep['type']>(['send_text', 'send_template', 'typing', 'wait_reply', 'handoff_agent', 'start_bot']);

function nowIso(): string {
  return new Date().toISOString();
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** "90 segundos" / "15 minutos" / "2 horas" / "3 dias" (histórico da execução) */
function formatDuration(seconds: number): string {
  const units: Array<[number, string, string]> = [
    [86400, 'dia', 'dias'],
    [3600, 'hora', 'horas'],
    [60, 'minuto', 'minutos'],
  ];
  for (const [size, one, many] of units) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${n === 1 ? one : many}`;
    }
  }
  return `${seconds} segundos`;
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

/**
 * Trava por execução: só uma instância mexe na run por vez. Via RPC
 * (UPDATE atômico): o PATCH do PostgREST com filtro `or` dá 42703 neste
 * banco, e a trava nunca era obtida (o robô ficava "running" sem rodar).
 */
async function claimBotLock(admin: SupabaseClient, runId: string, organizationId?: string): Promise<boolean> {
  let orgId = organizationId ?? null;
  if (!orgId) {
    const { data } = await admin.from('wa_bot_runs').select('organization_id').eq('id', runId).maybeSingle();
    orgId = (data as { organization_id?: string } | null)?.organization_id ?? null;
  }
  if (!orgId) return false;
  const { data, error } = await admin.rpc('wa_bot_claim_lock', {
    p_org: orgId,
    p_run: runId,
    p_seconds: BOT_LOCK_SECONDS,
  });
  if (error) {
    console.error('[wa-agents] trava da execução do robô falhou:', error.message);
    return false;
  }
  return data === true;
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
  /** Passos do robô (para gravar o id do passo onde a execução parou) */
  steps?: BotStep[];
  /** Última falha ou ação pulada: fica em `error` mesmo com a execução concluída */
  failure?: string | null;
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
  opts: { release?: boolean; renewLock?: boolean } = {}
): Promise<void> {
  // Retomada pelo id do passo (o índice muda quando o quadro é editado)
  if (typeof patch.step_index === 'number' && st.steps) {
    const at = st.steps[patch.step_index as number];
    if (at) st.vars[RESUME_STEP_VAR] = at.id;
    else delete st.vars[RESUME_STEP_VAR];
  }
  // Execução concluída com ação que falhou ou foi pulada: o motivo fica visível
  const failure = patch.status === 'done' && st.failure && !('error' in patch) ? { error: st.failure } : {};
  // Log sem crescer para sempre (robôs longos com várias retomadas)
  if (st.log.length > 500) st.log = st.log.slice(-500);
  const { error } = await admin
    .from('wa_bot_runs')
    .update({
      ...patch,
      ...failure,
      log: st.log,
      vars: st.vars,
      updated_at: nowIso(),
      ...(opts.release ? { lock_until: null } : {}),
      ...(opts.renewLock && !opts.release
        ? { lock_until: new Date(Date.now() + BOT_LOCK_SECONDS * 1000).toISOString() }
        : {}),
    })
    .eq('id', st.run.id)
    .eq('organization_id', st.run.organization_id);
  if (error) console.error('[wa-agents] salvar execução do robô falhou:', error.message);
}

function note(st: RunState, step: BotStep | null, text: string, status?: BotLogEntry['status'], error?: string): void {
  st.log.push({
    at: nowIso(),
    step_id: step?.id ?? null,
    type: step?.type ?? 'run',
    note: text,
    ...(status ? { status } : {}),
    ...(error ? { error } : {}),
  });
}

/** Rótulo curto do passo para o histórico e o campo de erro ("Mover etapa (abc123)") */
const STEP_LABEL: Partial<Record<BotStep['type'], string>> = {
  send_text: 'Mensagem',
  send_template: 'Modelo de mensagem',
  typing: 'Digitando',
  start_bot: 'Iniciar robô',
  wait: 'Aguardar',
  wait_reply: 'Aguardar resposta',
  condition: 'Condição',
  move_stage: 'Mover etapa',
  add_tag: 'Adicionar tag',
  remove_tag: 'Remover tag',
  create_lead: 'Criar lead',
  update_lead: 'Editar lead',
  webhook: 'Webhook',
  handoff_agent: 'Transferir para agente',
  end: 'Encerrar',
};
function stepRef(step: BotStep | null): string {
  if (!step) return 'Robô';
  return `${STEP_LABEL[step.type] ?? step.type} (${step.id})`;
}

/** Ação pulada (ex.: sem lead): registrada e visível no erro da execução, sem parar o fluxo */
function skipNote(st: RunState, step: BotStep, text: string): void {
  note(st, step, text, 'skipped', text);
  st.failure = `${stepRef(step)}: ${text}`;
}

/** Ação que falhou mas não para o fluxo */
function failNote(st: RunState, step: BotStep, text: string): void {
  note(st, step, `falhou: ${text}`, 'failed', text);
  st.failure = `${stepRef(step)}: ${text}`;
}

/**
 * Uma conversa tem UM robô por vez (decisão do produto: o mais novo vence).
 * Cancela as outras execuções ativas da conversa, exceto `keepRunId`.
 */
async function cancelOtherRunsInConversation(
  admin: SupabaseClient,
  orgId: string,
  conversationId: string,
  keepRunId: string
): Promise<number> {
  const { data, error } = await admin
    .from('wa_bot_runs')
    .update({ status: 'cancelled', wake_at: null, lock_until: null, updated_at: nowIso() })
    .eq('organization_id', orgId)
    .eq('conversation_id', conversationId)
    .in('status', ['running', 'waiting_reply'])
    .neq('id', keepRunId)
    .select('id');
  if (error) {
    console.error('[wa-agents] cancelar execuções anteriores falhou:', error.message);
    return 0;
  }
  return (data ?? []).length;
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

type BotTemplateRow = {
  id: string;
  name: string;
  type: string;
  language: string | null;
  body: string;
  meta_name: string | null;
  meta_status: string | null;
};

/**
 * Números em que o robô pode agir. Linhas antigas só tinham `connection_id`.
 */
export function botConnectionIds(bot: Pick<BotRow, 'connection_ids' | 'connection_id'>): string[] {
  const lista = (bot.connection_ids ?? []).filter(Boolean);
  if (lista.length > 0) return lista;
  return bot.connection_id ? [bot.connection_id] : [];
}

/**
 * Bloco "Modelo de mensagem": modelo do WhatsApp API sai como TEMPLATE de verdade pela
 * Meta (funciona fora da janela de 24 h e leva os botões aprovados); modelo geral, ou
 * número conectado por QR, vai como texto já preenchido. As variáveis ({{contato.nome}},
 * {{lead.titulo}}...) vêm do contato e do negócio, como no chat. Devolve o nome do modelo.
 */
async function sendBotTemplate(
  admin: SupabaseClient,
  st: RunState,
  connection: WaConnectionRow,
  phone: string,
  templateId: string,
  values: Record<string, string | undefined>
): Promise<string> {
  const { data, error } = await admin
    .from('message_templates')
    .select('id, name, type, language, body, meta_name, meta_status')
    .eq('organization_id', st.run.organization_id)
    .eq('id', templateId)
    .maybeSingle();
  if (error) throw new Error(`carregar modelo falhou: ${error.message}`);
  const tpl = data as BotTemplateRow | null;
  if (!tpl) throw new Error('modelo de mensagem não encontrado');
  if (connection.status !== 'connected') throw new Error('número desconectado');
  const provider = getProvider(connection);
  const sendTemplate = provider.sendTemplate?.bind(provider);
  const text = fillTemplate(tpl.body, values) || `[Modelo: ${tpl.name}]`;
  let result: SendResult;
  try {
    if (tpl.type === 'whatsapp_api' && tpl.meta_name && sendTemplate) {
      const params = templateParams(tpl.body, values);
      result = await sendTemplate({
        to: phone,
        name: tpl.meta_name,
        language: (tpl.language || 'pt_BR').trim(),
        components: params.length
          ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: p })) }]
          : undefined,
      });
    } else {
      result = await provider.sendText({ to: phone, text });
    }
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
    console.error('[wa-agents] gravar modelo do robô falhou:', errorMessage(e));
  }
  if (!result.ok) throw new Error(`envio do modelo falhou: ${result.error || 'erro desconhecido'}`);
  return tpl.name;
}

/**
 * Envio avulso numa conversa (follow-up por inatividade da etapa), com as mesmas
 * regras do robô: número conectado, mensagem gravada no chat e réplica nas
 * outras orgs do mesmo número. Lança em caso de falha.
 */
export async function sendTextToConversation(
  admin: SupabaseClient,
  input: { organizationId: string; conversationId: string; connection: WaConnectionRow; phone: string; text: string }
): Promise<void> {
  const st = { run: { organization_id: input.organizationId, conversation_id: input.conversationId }, log: [], vars: {} } as unknown as RunState;
  await sendBotText(admin, st, input.connection, input.phone, input.text);
}

/** Modelo de mensagem avulso numa conversa (mesma lógica do bloco do robô). Devolve o nome do modelo. */
export async function sendTemplateToConversation(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    connection: WaConnectionRow;
    phone: string;
    templateId: string;
    values: Record<string, string | undefined>;
  }
): Promise<string> {
  const st = { run: { organization_id: input.organizationId, conversation_id: input.conversationId }, log: [], vars: {} } as unknown as RunState;
  return sendBotTemplate(admin, st, input.connection, input.phone, input.templateId, input.values);
}

// ---------------------------------------------------------------------------
// Condição (estilo Typebot/Switch): campo · operador · valor, combinados por E/OU
// ---------------------------------------------------------------------------
export type ConditionEnv = {
  reply: string;
  tags: string[];
  stageId: string | null;
  boardId: string | null;
  contactName: string;
  contactPhone: string;
  dealTitle: string;
  dealValue: number | null;
  dealSource: string;
  customFields: Record<string, unknown>;
  contextoExtra: string;
};

function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!s) return null;
  // "1.500,00" (pt-BR) -> 1500.00; "1500.50" -> 1500.50
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function conditionFieldValue(clause: BotConditionClause, env: ConditionEnv): unknown {
  switch (clause.field) {
    case 'reply':
      return env.reply;
    case 'tags':
      return env.tags;
    case 'stage':
      return env.stageId ?? '';
    case 'board':
      return env.boardId ?? '';
    case 'contact_name':
      return env.contactName;
    case 'contact_phone':
      return env.contactPhone;
    case 'deal_title':
      return env.dealTitle;
    case 'deal_value':
      return env.dealValue;
    case 'deal_source':
      return env.dealSource;
    case 'custom_field':
      return clause.key ? env.customFields[clause.key] : undefined;
    case 'contexto_extra':
      return env.contextoExtra;
  }
}

/** Uma condição. Textos comparados sem acentos/maiúsculas; ids (etapa/quadro) comparados exatos. */
export function evalConditionClause(clause: BotConditionClause, env: ConditionEnv): boolean {
  const raw = conditionFieldValue(clause, env);
  const list = Array.isArray(raw) ? raw.map(v => String(v ?? '')) : null;
  const text = list ? list.join(', ') : raw === null || raw === undefined ? '' : String(raw);
  const exact = clause.field === 'stage' || clause.field === 'board';
  const norm = (v: string) => (exact ? v.trim() : normalizeKeyword(v));
  const a = norm(text);
  const b = norm(clause.value ?? '');
  switch (clause.op) {
    case 'is_empty':
      return list ? list.length === 0 : a.length === 0;
    case 'not_empty':
      return list ? list.length > 0 : a.length > 0;
    case 'contains':
      return b.length > 0 && (list ? list.some(v => norm(v) === b || norm(v).includes(b)) : a.includes(b));
    case 'not_contains':
      return b.length > 0 && !(list ? list.some(v => norm(v) === b || norm(v).includes(b)) : a.includes(b));
    case 'equals':
      if (clause.field === 'deal_value') {
        const x = parseNumber(raw), y = parseNumber(clause.value);
        return x !== null && y !== null && x === y;
      }
      return a === b;
    case 'not_equals':
      if (clause.field === 'deal_value') {
        const x = parseNumber(raw), y = parseNumber(clause.value);
        return x === null || y === null || x !== y;
      }
      return a !== b;
    case 'starts_with':
      return b.length > 0 && a.startsWith(b);
    case 'ends_with':
      return b.length > 0 && a.endsWith(b);
    case 'gt': {
      const x = parseNumber(raw), y = parseNumber(clause.value);
      return x !== null && y !== null && x > y;
    }
    case 'lt': {
      const x = parseNumber(raw), y = parseNumber(clause.value);
      return x !== null && y !== null && x < y;
    }
  }
}

/** Um caminho: `clauses` combinadas por E/OU; sem clauses, a regra antiga (kind/keywords/tag/stage_id). */
export function evalConditionRule(rule: BotConditionRule, env: ConditionEnv): boolean {
  const clauses = rule.clauses ?? [];
  if (clauses.length > 0) {
    return rule.match === 'any' ? clauses.some(c => evalConditionClause(c, env)) : clauses.every(c => evalConditionClause(c, env));
  }
  const kind = rule.kind ?? 'reply_contains';
  const reply = normalizeKeyword(env.reply);
  if (kind === 'reply_contains' || kind === 'reply_not_contains') {
    const found = (rule.keywords ?? []).some(k => {
      const kw = normalizeKeyword(k);
      return kw.length > 0 && reply.includes(kw);
    });
    return kind === 'reply_contains' ? found : (rule.keywords ?? []).length > 0 && !found;
  }
  if (kind === 'tag_has' || kind === 'tag_not_has') {
    const tag = normalizeKeyword(rule.tag ?? '');
    const has = tag.length > 0 && env.tags.some(t => normalizeKeyword(t) === tag);
    return kind === 'tag_has' ? has : tag.length > 0 && !has;
  }
  const is = !!rule.stage_id && env.stageId === rule.stage_id;
  return kind === 'stage_is' ? is : !!rule.stage_id && !is;
}

/**
 * Processa uma execução a partir de `run.step_index`. Quem chama já deve ter
 * a trava (claimBotLock) ou ter acabado de criar a run.
 */
/**
 * Move o negócio para uma etapa de OUTRO quadro da mesma organização (troca
 * board_id e stage_id juntos). A etapa precisa pertencer ao quadro de destino.
 */
async function moveDealToBoardStage(
  admin: SupabaseClient,
  orgId: string,
  dealId: string,
  boardId: string,
  stageId: string,
  loss: { reason?: string | null; category?: 'qualified' | 'disqualified' | null } = {}
): Promise<void> {
  const { data: stage, error: stageError } = await admin
    .from('board_stages')
    .select('id')
    .eq('organization_id', orgId)
    .eq('board_id', boardId)
    .eq('id', stageId)
    .maybeSingle();
  if (stageError) throw new Error(stageError.message);
  if (!stage) throw new Error('etapa de destino não pertence ao pipeline escolhido');
  const now = nowIso();
  // Etapa de ganho/perda do quadro de destino marca o lead (antes a troca de pipeline ignorava)
  const { data: boardCfg } = await admin
    .from('boards')
    .select('won_stage_id, lost_stage_id')
    .eq('organization_id', orgId)
    .eq('id', boardId)
    .maybeSingle();
  const cfg = (boardCfg as { won_stage_id?: string | null; lost_stage_id?: string | null } | null) ?? {};
  const updates: Record<string, unknown> = { board_id: boardId, stage_id: stageId, last_stage_change_date: now, updated_at: now };
  if (cfg.won_stage_id && cfg.won_stage_id === stageId) {
    Object.assign(updates, { is_won: true, is_lost: false, closed_at: now, loss_reason: null });
  } else if (cfg.lost_stage_id && cfg.lost_stage_id === stageId) {
    Object.assign(updates, { is_lost: true, is_won: false, closed_at: now });
    if (loss.reason?.trim()) updates.loss_reason = loss.reason.trim().slice(0, 200);
    if (loss.category) updates.loss_category = loss.category;
  }
  const { error } = await admin
    .from('deals')
    .update(updates)
    .eq('organization_id', orgId)
    .eq('id', dealId);
  if (error) throw new Error(error.message);
}

export async function processBotRun(adminRaw: SupabaseClient, run: BotRunRow): Promise<void> {
  // o que o robô altera no lead entra no histórico como "robô"
  const admin = withActor(adminRaw, { kind: 'bot', id: run.bot_id });
  const st: RunState = {
    run,
    log: Array.isArray(run.log) ? ([...run.log] as BotLogEntry[]) : [],
    vars: { ...((run.vars ?? {}) as Record<string, unknown>) },
  };
  const orgId = run.organization_id;
  let currentStep: BotStep | null = null;

  try {
    // Robô roda para QUALQUER organização (saiu da beta). Só o passo
    // "entregar a agente" depende da liberação do agente de IA, conferida
    // adiante, no próprio passo.
    const bot = await loadBot(admin, orgId, run.bot_id);
    if (!bot || !bot.enabled) {
      note(st, null, bot ? 'robô desligado' : 'robô não encontrado');
      await saveRun(admin, st, { status: 'cancelled' }, { release: true });
      return;
    }
    const rawSteps = Array.isArray(bot.steps) ? bot.steps : [];
    const steps = parseSteps(bot.steps);
    st.steps = steps;
    if (steps.length < rawSteps.length) {
      note(st, null, `${rawSteps.length - steps.length} passo(s) inválido(s) ignorado(s)`, 'failed');
    }
    if (steps.length === 0) {
      note(st, null, 'robô sem passos');
      await saveRun(admin, st, { status: 'done' }, { release: true });
      return;
    }

    // Conversa existente: dela vêm contato e negócio quando a execução não trouxe
    // (robô iniciado pelo chat, API ou agente). Sem isso "Mover etapa" e "Tag"
    // eram pulados em silêncio e {{nome}} saía vazio.
    type ConvLite = { wa_phone: string | null; connection_id: string | null; contact_id: string | null; deal_id: string | null };
    let convRow: ConvLite | null = null;
    if (run.conversation_id) {
      const { data } = await admin
        .from('wa_conversations')
        .select('wa_phone, connection_id, contact_id, deal_id')
        .eq('organization_id', orgId)
        .eq('id', run.conversation_id)
        .maybeSingle();
      convRow = (data as ConvLite | null) ?? null;
    }

    // Negócio e contato
    let contactId = run.contact_id ?? convRow?.contact_id ?? null;
    if (!contactId && !run.deal_id && !convRow?.deal_id) {
      // Último recurso: contato pelo telefone (com e sem o nono dígito)
      const variants = brPhoneVariants(run.phone || convRow?.wa_phone || '');
      if (variants.length > 0) {
        const { data } = await admin
          .from('contacts')
          .select('id')
          .eq('organization_id', orgId)
          .in('phone', variants)
          .is('deleted_at', null)
          .limit(1)
          .maybeSingle();
        contactId = (data as { id?: string } | null)?.id ?? null;
      }
    }
    let deal = await loadDealContext(admin, orgId, { dealId: run.deal_id ?? convRow?.deal_id ?? null, contactId });
    let contact: { id: string; name: string; phone: string | null; email: string | null } | null = null;
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
      // email entra no contato porque os webhooks do robô mandam {{contact.email}}
      // (integrações usam o e-mail pra casar o cliente do outro lado)
      const { data } = await admin
        .from('contacts')
        .select('id, name, phone, email')
        .eq('organization_id', orgId)
        .eq('id', contactId)
        .maybeSingle();
      contact = (data as { id: string; name: string; phone: string | null; email: string | null } | null) ?? null;
    }

    // Conversa (cria na primeira execução)
    let connection: WaConnectionRow | null = null;
    /** Número da conversa existente: é ele que envia (o do robô só como reserva) */
    let convConnectionId: string | null = null;
    let phone = run.phone ? normalizePhoneE164(run.phone) : '';
    // Automação só de CRM (etapa, rótulo, webhook, condição, espera): roda sem
    // abrir conversa no WhatsApp e sem exigir telefone ou número.
    const needsConversation = steps.some((s) => CONVERSATION_STEP_TYPES.has(s.type));
    if (!run.conversation_id && !needsConversation) {
      phone = normalizePhoneE164(run.phone || contact?.phone || '');
      if (!st.run.contact_id && (contact?.id || contactId)) {
        st.run = { ...st.run, contact_id: contact?.id ?? contactId ?? null };
      }
    } else if (!run.conversation_id) {
      phone = normalizePhoneE164(run.phone || contact?.phone || '');
      if (!phone) {
        note(st, null, 'sem telefone para enviar');
        await saveRun(admin, st, { status: 'error', error: 'sem telefone' }, { release: true });
        return;
      }
      // Número que inicia a conversa: o escolhido no gatilho (se for um dos do
      // robô) ou o primeiro da lista dele.
      const permitidosInicio = botConnectionIds(bot);
      const doGatilho = bot.trigger?.connection_id ?? null;
      const numeroInicial =
        doGatilho && (permitidosInicio.length === 0 || permitidosInicio.includes(doGatilho))
          ? doGatilho
          : permitidosInicio[0];
      if (!numeroInicial) {
        note(st, null, 'robô sem número configurado');
        await saveRun(admin, st, { status: 'error', error: 'robô sem número' }, { release: true });
        return;
      }
      // O número precisa ser da organização antes de criar a conversa
      connection = await getConnectionByIdForOrg(admin, orgId, numeroInicial);
      if (!connection) {
        note(st, null, 'número do robô não encontrado nesta organização');
        await saveRun(admin, st, { status: 'error', error: 'número do robô não encontrado' }, { release: true });
        return;
      }
      const conv = await ensureConversation(admin, orgId, numeroInicial, phone, contact?.name ?? null);
      st.run = { ...st.run, conversation_id: conv.id, phone, contact_id: contact?.id ?? contactId ?? null };
      await saveRun(admin, st, { conversation_id: conv.id, phone, contact_id: st.run.contact_id });
    } else {
      // Execução presa a uma conversa existente (iniciada pelo chat ou retomada):
      // envia pelo número da conversa, para a resposta do lead cair nela
      const conv = convRow;
      convConnectionId = conv?.connection_id ?? null;
      if (!phone) phone = conv?.wa_phone ?? '';
      if (!phone) {
        note(st, null, 'conversa sem telefone');
        await saveRun(admin, st, { status: 'error', error: 'conversa sem telefone' }, { release: true });
        return;
      }
      // O robô é exclusivo dos números escolhidos nele: numa conversa de outro
      // número ele não fala (antes, o envio saía pelo número da conversa e podia
      // ir por um número que o robô nem atende).
      const permitidos = botConnectionIds(bot);
      // Lista vazia = robô sem número (antes valia como "todos os números")
      if (convConnectionId && !permitidos.includes(convConnectionId)) {
        note(st, null, 'a conversa é de um número que este robô não atende');
        await saveRun(
          admin,
          st,
          { status: 'error', error: 'robô não atende o número desta conversa' },
          { release: true }
        );
        return;
      }
    }
    const conversationId: string | null = st.run.conversation_id ?? null;
    // Guarda na execução o negócio e o contato encontrados (histórico e retomadas)
    const resolvedIds: Record<string, unknown> = {};
    if (deal && st.run.deal_id !== deal.id) resolvedIds.deal_id = deal.id;
    const resolvedContact = contact?.id ?? contactId ?? null;
    if (resolvedContact && st.run.contact_id !== resolvedContact) resolvedIds.contact_id = resolvedContact;
    if (Object.keys(resolvedIds).length > 0) {
      st.run = { ...st.run, ...resolvedIds } as BotRunRow;
      await saveRun(admin, st, resolvedIds);
    }

    const getConnection = async (): Promise<WaConnectionRow> => {
      if (connection) return connection;
      const fromConversation = !!convConnectionId;
      const connectionId = convConnectionId || botConnectionIds(bot)[0];
      if (!connectionId) throw new Error('conversa sem número e robô sem número configurado');
      connection = await getConnectionByIdForOrg(admin, orgId, connectionId);
      if (!connection) {
        throw new Error(fromConversation ? 'número da conversa não encontrado nesta organização' : 'número do robô não encontrado');
      }
      return connection;
    };

    // Id da última mensagem do contato: a Cloud API da Meta precisa dele tanto
    // pro "lido" quanto pro "digitando" (no QR é ignorado). Buscado uma vez só.
    let lastInboundId: string | null | undefined;
    const getLastInboundId = async (): Promise<string | null> => {
      if (lastInboundId === undefined) {
        if (!conversationId) return null;
        lastInboundId = await loadLastInboundProviderId(admin, {
          organizationId: orgId,
          conversationId,
        }).catch(() => null);
      }
      return lastInboundId;
    };

    /**
     * "digitando..." pelo tempo pedido. A Evolution segura a chamada pelo tempo da
     * presença, então só espera o que falta. Tempo acima do limite em linha vira
     * espera agendada: devolve o instante de acordar (quem chama estaciona a execução).
     */
    const showTyping = async (step: BotStep, seconds: number): Promise<string | null> => {
      const total = Math.min(60, Math.max(1, Math.round(seconds)));
      const provider = getProvider(await getConnection());
      const startedTyping = Date.now();
      if (provider.sendTyping) {
        try {
          await provider.sendTyping({
            to: phone,
            ms: Math.min(total, INLINE_WAIT_MAX_S) * 1000,
            providerMessageId: (await getLastInboundId()) ?? undefined,
          });
        } catch (e) {
          note(st, step, `presença "digitando" falhou: ${errorMessage(e)}`);
        }
      }
      note(st, step, `digitando por ${total}s`);
      const remainingMs = total * 1000 - (Date.now() - startedTyping);
      if (remainingMs > INLINE_WAIT_MAX_S * 1000) return new Date(Date.now() + remainingMs).toISOString();
      if (remainingMs > 0) await sleep(remainingMs);
      return null;
    };

    // Dois tiques azuis antes de o robô falar. Enfeite: falha aqui não para o robô.
    try {
      const inboundId = await getLastInboundId();
      if (inboundId) {
        const provider = getProvider(await getConnection());
        if (provider.markRead) await provider.markRead({ to: phone, providerMessageId: inboundId });
      }
    } catch (e) {
      note(st, null, `marcar como lido falhou: ${errorMessage(e)}`);
    }

    const nome = (contact?.name || '').trim();
    const tplVars: Record<string, unknown> = {
      nome,
      // contexto escrito pela equipe ao iniciar o robô pelo chat ({{contexto_extra}} nas mensagens)
      contexto_extra: String(st.vars.contexto_extra ?? ''),
      nome_lead: nome,
      primeiro_nome: nome.split(/\s+/)[0] ?? '',
      telefone: phone,
      negocio: { titulo: deal?.title ?? '', etapa: deal?.stage_label ?? '' },
    };
    // Variáveis dos modelos de mensagem ({{contato.nome}}, {{lead.titulo}}...), como no chat
    const templateValues: Record<string, string | undefined> = {
      'contato.nome': nome,
      'contato.telefone': phone,
      'lead.titulo': deal?.title ?? '',
      'lead.etapa': deal?.stage_label ?? '',
    };

    /** Relê o negócio depois de uma ação de CRM: condições seguintes enxergam a etapa e as tags novas */
    const reloadDeal = async () => {
      deal = await loadDealContext(admin, orgId, { dealId: deal?.id ?? null, contactId: contact?.id ?? contactId });
      tplVars.negocio = { titulo: deal?.title ?? '', etapa: deal?.stage_label ?? '' };
      templateValues['lead.titulo'] = deal?.title ?? '';
      templateValues['lead.etapa'] = deal?.stage_label ?? '';
    };

    // Modo quadro: começa no passo inicial e navega só por ids; modo lista: índice + 1
    const canvas = !!(bot.start_step_id && String(bot.start_step_id).trim());
    let idx = st.run.step_index ?? 0;
    // Só entra pelo passo inicial quando a execução é nova: uma execução antiga (criada em modo
    // lista, antes de o robô virar quadro) retoma de onde parou em vez de recomeçar
    const fresh = idx === 0 && st.log.filter(e => e.type !== 'run').length === 0 && !st.vars[RESUME_STEP_VAR];
    if (!fresh && typeof st.vars[RESUME_STEP_VAR] === 'string') {
      // Retoma pelo id: o robô pode ter sido editado enquanto a execução esperava
      const byId = stepIndexById(steps, st.vars[RESUME_STEP_VAR] as string);
      if (byId >= 0) idx = byId;
    }
    // Conversa com UM robô por vez: execução nova cancela as anteriores da conversa
    if (fresh && conversationId) {
      const cancelled = await cancelOtherRunsInConversation(admin, orgId, conversationId, st.run.id);
      if (cancelled > 0) note(st, null, `${cancelled} execução(ões) anterior(es) desta conversa cancelada(s)`);
    }
    if (canvas && fresh) {
      const startIdx = stepIndexById(steps, bot.start_step_id);
      if (startIdx < 0) {
        note(st, null, 'passo inicial não encontrado');
        await saveRun(admin, st, { status: 'error', error: 'passo inicial não encontrado', wake_at: null }, { release: true });
        return;
      }
      idx = startIdx;
    }
    const next = (step: BotStep): number => nextStepIndex(steps, idx, step, canvas);
    // Passos já visitados neste processamento (wait/wait_reply encerram o processamento):
    // voltar a um deles sem espera no meio é laço, e mandaria mensagens em rajada
    const visited = new Set<number>();

    for (let guard = 0; guard < MAX_STEPS_PER_RUN; guard++) {
      const step = steps[idx];
      currentStep = step ?? null;
      if (!step) {
        note(st, null, 'fim dos passos');
        await saveRun(admin, st, { status: 'done', step_index: idx, wake_at: null }, { release: true });
        return;
      }
      if (visited.has(idx)) {
        note(st, step, 'laço sem espera entre passos');
        await saveRun(
          admin,
          st,
          { status: 'error', step_index: idx, wake_at: null, error: 'laço sem espera entre passos' },
          { release: true }
        );
        return;
      }
      visited.add(idx);

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

      // Progresso gravado a cada passo (com a trava renovada): se a instância cair
      // no meio, a retomada não reenvia o que já foi enviado
      if (guard > 0) await saveRun(admin, st, { step_index: idx }, { renewLock: true });

      try {
      switch (step.type) {
        case 'send_text': {
          if ((step.typing_seconds ?? 0) > 0 && st.vars[TYPED_STEP_VAR] !== step.id) {
            const wakeAt = await showTyping(step, step.typing_seconds ?? 0);
            if (wakeAt) {
              // digitação longa: acorda no fim e envia sem repetir o "digitando"
              st.vars[TYPED_STEP_VAR] = step.id;
              await saveRun(admin, st, { status: 'running', step_index: idx, wake_at: wakeAt }, { release: true });
              return;
            }
          }
          delete st.vars[TYPED_STEP_VAR];
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
        case 'send_template': {
          if (st.vars[TEMPLATE_ROUTE_VAR] === step.id) {
            // Voltou com a resposta do lead: botão de resposta rápida → saída do botão; outra resposta → "Outra resposta"
            delete st.vars[TEMPLATE_ROUTE_VAR];
            const reply = normalizeKeyword(String(st.vars.last_reply ?? ''));
            let hit = reply ? step.buttons.findIndex(b => normalizeKeyword(b) === reply) : -1;
            if (hit < 0 && reply) {
              hit = step.buttons.findIndex(b => {
                const kw = normalizeKeyword(b);
                return kw.length > 0 && reply.includes(kw);
              });
            }
            const targetId = hit >= 0 ? (step.button_step_ids[hit] ?? null) : (step.next_step_id ?? null);
            note(st, step, hit >= 0 ? `respondeu pelo botão "${step.buttons[hit]}"` : 'outra resposta');
            idx = stepIndexById(steps, targetId);
            if (idx < 0) {
              // Saída sem ligação no quadro: o robô termina aqui (agora com o motivo no histórico)
              note(st, step, hit >= 0 ? `botão "${step.buttons[hit]}" sem próximo bloco: encerrando` : '"Outra resposta" sem próximo bloco: encerrando');
            }
            break;
          }
          if ((step.typing_seconds ?? 0) > 0 && st.vars[TYPED_STEP_VAR] !== step.id) {
            const wakeAt = await showTyping(step, step.typing_seconds ?? 0);
            if (wakeAt) {
              st.vars[TYPED_STEP_VAR] = step.id;
              await saveRun(admin, st, { status: 'running', step_index: idx, wake_at: wakeAt }, { release: true });
              return;
            }
          }
          delete st.vars[TYPED_STEP_VAR];
          const tplName = await sendBotTemplate(admin, st, await getConnection(), phone, step.template_id, templateValues);
          const tplSeconds = step.timeout_seconds ?? step.timeout_minutes * 60;
          note(st, step, `modelo enviado: ${tplName}; esperando resposta por até ${formatDuration(tplSeconds)}`);
          // Espera a resposta (botão ou texto); sem resposta no prazo, segue por "Sem resposta"
          const wakeAt = new Date(Date.now() + tplSeconds * 1000).toISOString();
          st.vars[TIMEOUT_STEP_VAR] = step.on_timeout_step_id ?? null;
          st.vars[TEMPLATE_ROUTE_VAR] = step.id;
          await saveRun(admin, st, { status: 'waiting_reply', step_index: idx, wake_at: wakeAt }, { release: true });
          return;
        }
        case 'wait': {
          if (step.seconds <= INLINE_WAIT_MAX_S) {
            // espera curta: aqui mesmo, sem soltar a execução para o relógio
            note(st, step, `esperando ${step.seconds}s`);
            await sleep(step.seconds * 1000);
            idx = next(step);
            break;
          }
          const wakeAt = new Date(Date.now() + step.seconds * 1000).toISOString();
          note(st, step, `esperando ${step.seconds}s`);
          await saveRun(admin, st, { status: 'running', step_index: next(step), wake_at: wakeAt }, { release: true });
          return;
        }
        case 'typing': {
          // A Evolution já segura a chamada pelo tempo do "digitando": espera só o que falta
          // (antes somava as duas coisas e 3 s viravam uns 7 s). Tempo longo vira espera agendada.
          const wakeAt = await showTyping(step, step.seconds);
          if (wakeAt) {
            await saveRun(admin, st, { status: 'running', step_index: next(step), wake_at: wakeAt }, { release: true });
            return;
          }
          idx = next(step);
          break;
        }
        case 'start_bot': {
          const depth = Number(st.vars[CHAIN_DEPTH_VAR] ?? 0) || 0;
          if (depth >= MAX_CHAIN_DEPTH) throw new Error(`cadeia de robôs longa demais (limite de ${MAX_CHAIN_DEPTH})`);
          const created = await createBotRun(admin, {
            organizationId: orgId,
            botId: step.bot_id,
            conversationId,
            dealId: st.run.deal_id ?? null,
            contactId: st.run.contact_id ?? null,
            phone,
            context: st.vars.contexto_extra ? String(st.vars.contexto_extra) : null,
            chainDepth: depth + 1,
          });
          if (!created.ok || !created.run) throw new Error(`não iniciou o outro robô: ${created.error || 'erro'}`);
          note(st, step, `encerrado; robô "${step.bot_name || step.bot_id}" iniciado`);
          await saveRun(admin, st, { status: 'done', step_index: idx + 1, wake_at: null }, { release: true });
          await runBotRunNow(admin, created.run);
          return;
        }
        case 'wait_reply': {
          const replySeconds = step.timeout_seconds ?? step.timeout_minutes * 60;
          const wakeAt = new Date(Date.now() + replySeconds * 1000).toISOString();
          st.vars[TIMEOUT_STEP_VAR] = step.on_timeout_step_id ?? null;
          note(st, step, `esperando resposta por até ${formatDuration(replySeconds)}`);
          await saveRun(
            admin,
            st,
            { status: 'waiting_reply', step_index: next(step), wake_at: wakeAt },
            { release: true }
          );
          return;
        }
        case 'condition': {
          const env: ConditionEnv = {
            reply: String(st.vars.last_reply ?? ''),
            tags: deal?.tags ?? [],
            stageId: deal?.stage_id ?? null,
            boardId: deal?.board_id ?? null,
            contactName: contact?.name ?? '',
            contactPhone: contact?.phone ?? phone,
            dealTitle: deal?.title ?? '',
            dealValue: deal?.value ?? null,
            dealSource: deal?.source ?? '',
            customFields: deal?.custom_fields ?? {},
            contextoExtra: String(st.vars.contexto_extra ?? ''),
          };
          let target = -1;
          let matched: string | null = null;
          for (const [i, rule] of step.rules.entries()) {
            if (evalConditionRule(rule, env)) {
              matched = rule.label?.trim() || `caminho ${i + 1}`;
              target = stepIndexById(steps, rule.goto_step_id);
              break;
            }
          }
          if (matched) {
            if (target < 0) throw new Error(`passo de destino não encontrado (${matched})`);
            note(st, step, `${matched}: indo para o passo ${steps[target].id}`);
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
            skipNote(st, step, 'contato sem lead aberto: etapa não alterada');
          } else {
            const lossReason = step.loss_reason ? renderTemplate(step.loss_reason, tplVars).trim() : '';
            const lossCategory = step.loss_category ?? null;
            if (step.board_id && step.board_id !== deal.board_id) {
              await moveDealToBoardStage(admin, orgId, deal.id, step.board_id, step.stage_id, { reason: lossReason, category: lossCategory });
              note(st, step, 'lead movido para outro pipeline', 'ok');
            } else {
              const r = await moveStageByDealId({
                organizationId: orgId,
                dealId: deal.id,
                target: { to_stage_id: step.stage_id },
                lossReason: lossReason || null,
                lossCategory,
              });
              if (!r.ok) throw new Error((r.body as { error?: string }).error || 'falha ao mover etapa');
              note(st, step, 'lead movido de etapa', 'ok');
            }
            // Perda registrada também no histórico do lead (com classificação e motivo)
            await recordLossHistory(admin, {
              organizationId: orgId,
              dealId: deal.id,
              stageId: step.stage_id,
              lossReason: lossReason || null,
              lossCategory,
              by: `robô ${bot.name}`,
            });
            await reloadDeal();
          }
          idx = next(step);
          break;
        }
        case 'remove_tag': {
          if (!deal) {
            skipNote(st, step, `contato sem lead aberto: tag "${step.tag}" não removida`);
          } else {
            const removed = await removeDealTag(admin, orgId, deal.id, renderTemplate(step.tag, tplVars));
            note(st, step, removed ? `tag "${step.tag}" removida` : `o lead não tinha a tag "${step.tag}"`, 'ok');
            if (removed) await reloadDeal();
          }
          idx = next(step);
          break;
        }
        case 'create_lead': {
          const render = (text: string) => renderTemplate(text, tplVars);
          const r = await ensureLeadForContact(admin, {
            organizationId: orgId,
            contactId: contact?.id ?? contactId,
            phone,
            contactName: contact?.name ?? null,
            boardId: step.board_id,
            stageId: step.stage_id,
            changes: step.changes ?? [],
            render,
            conversationId,
          });
          contactId = r.contactId;
          if (!st.run.contact_id) st.run = { ...st.run, contact_id: r.contactId };
          st.run = { ...st.run, deal_id: r.dealId };
          await saveRun(admin, st, { deal_id: r.dealId, contact_id: st.run.contact_id });
          deal = await loadDealContext(admin, orgId, { dealId: r.dealId });
          await reloadDeal();
          if (r.created) {
            if (r.problems.length > 0) failNote(st, step, `lead criado, mas: ${r.problems.join('; ')}`);
            else note(st, step, 'lead criado', 'ok');
          } else {
            note(st, step, `${r.reason}: nada foi criado`, 'ok');
          }
          idx = next(step);
          break;
        }
        case 'update_lead': {
          if (!deal) {
            skipNote(st, step, 'contato sem lead aberto: nada foi alterado');
          } else {
            const r = await applyLeadChanges(admin, {
              organizationId: orgId,
              dealId: deal.id,
              changes: step.changes,
              render: (text: string) => renderTemplate(text, tplVars),
            });
            if (r.problems.length > 0) {
              failNote(st, step, `${r.changed.length > 0 ? `alterado: ${r.changed.join(', ')}; ` : ''}não aplicado: ${r.problems.join('; ')}`);
            } else {
              note(st, step, r.changed.length > 0 ? `lead atualizado: ${r.changed.join(', ')}` : 'nada para alterar', 'ok');
            }
            await reloadDeal();
          }
          idx = next(step);
          break;
        }
        case 'add_tag': {
          if (!deal) {
            skipNote(st, step, `contato sem lead aberto: tag "${step.tag}" não adicionada`);
          } else {
            await addDealTag(admin, orgId, deal.id, step.tag);
            note(st, step, `tag "${step.tag}" adicionada`, 'ok');
            await reloadDeal();
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
          if (r.ok) note(st, step, `webhook enviado (HTTP ${r.status ?? '?'})`, 'ok');
          else failNote(st, step, `webhook: ${r.error ?? 'erro desconhecido'}`);
          idx = next(step);
          break;
        }
        case 'handoff_agent': {
          if (!conversationId) throw new Error('sem conversa para entregar ao agente');
          // O robô é livre, mas ENTREGAR a um agente de IA só vale se a
          // organização tiver o agente liberado pelo super admin.
          if (!(await isAiAgentsApproved(admin, orgId))) {
            throw new Error('agente de IA não liberado para esta organização');
          }
          const agent = await loadAgent(admin, orgId, step.agent_id);
          if (!agent) throw new Error('agente de destino não encontrado');
          if (!agent.enabled) throw new Error('agente de destino desligado');
          const now = nowIso();
          // Estado atual da conversa: o robô de follow-up devolve ao MESMO agente sem apagar dados
          // salvos, follow-ups feitos nem memória; agente diferente zera só o contador de respostas
          const { data: convRow } = await admin
            .from('wa_conversations')
            .select('ai_agent_id, ai_state')
            .eq('organization_id', orgId)
            .eq('id', conversationId)
            .maybeSingle();
          const currentAgentId = (convRow as { ai_agent_id?: string | null } | null)?.ai_agent_id ?? null;
          const currentState = ((convRow as { ai_state?: Record<string, unknown> | null } | null)?.ai_state ?? {}) as Record<string, unknown>;
          const { error } = await admin
            .from('wa_conversations')
            .update({
              ai_agent_id: agent.id,
              ai_status: 'active',
              ai_status_changed_at: now,
              // o contexto escrito pela equipe ao iniciar o robô segue para o agente
              ai_state: {
                ...currentState,
                ...(currentAgentId !== agent.id ? { respostas: 0 } : {}),
                ...(st.vars.contexto_extra ? { contexto_extra: String(st.vars.contexto_extra) } : {}),
              },
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
          // Encerrar vale para a CONVERSA: nenhuma outra execução de robô continua nela
          // (antes só esta terminava e uma cópia paralela seguia mandando follow-up)
          const cancelled = conversationId ? await cancelOtherRunsInConversation(admin, orgId, conversationId, st.run.id) : 0;
          note(st, step, cancelled > 0 ? `encerrado; ${cancelled} outra(s) execução(ões) cancelada(s)` : 'encerrado', 'ok');
          await saveRun(admin, st, { status: 'done', step_index: idx, wake_at: null }, { release: true });
          return;
        }
        default: {
          note(st, step, 'tipo de passo desconhecido, ignorado');
          idx = next(step);
        }
      }
      } catch (stepError) {
        // Ação de CRM que falha não derruba o resto do balão: registra e segue
        if (CONTINUE_ON_FAILURE.has(step.type)) {
          failNote(st, step, errorMessage(stepError));
          idx = next(step);
          continue;
        }
        throw stepError;
      }
    }
    note(st, null, 'limite de passos por execução atingido');
    await saveRun(admin, st, { status: 'error', step_index: idx, error: 'limite de passos' }, { release: true });
  } catch (e) {
    const msg = errorMessage(e);
    console.error('[wa-agents] robô falhou:', msg);
    // Qual passo falhou e por quê (antes o erro ficava sem o passo)
    note(st, currentStep, `erro: ${msg}`, 'failed', msg);
    await saveRun(admin, st, { status: 'error', error: `${stepRef(currentStep)}: ${msg}`, wake_at: null }, { release: true });
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
    const vars: Record<string, unknown> = { ...((run.vars ?? {}) as Record<string, unknown>), last_reply: lastReply, last_reply_message_id: message.id };
    // Respondeu: o destino de "sem resposta" não vale mais
    delete vars[TIMEOUT_STEP_VAR];
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
    const locked = await claimBotLock(admin, run.id, run.organization_id);
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
  // A resposta do lead pode ter chegado neste instante: só segue quem tirar a execução de 'waiting_reply'
  const { data: claimed } = await admin
    .from('wa_bot_runs')
    .update({ status: 'running', updated_at: nowIso() })
    .eq('id', run.id)
    .eq('organization_id', run.organization_id)
    .eq('status', 'waiting_reply')
    .select('id')
    .maybeSingle();
  if (!claimed) return;
  const bot = await loadBot(admin, run.organization_id, run.bot_id);
  const steps = bot ? parseSteps(bot.steps) : [];
  st.steps = steps;
  let timeoutStepId = (st.vars[TIMEOUT_STEP_VAR] as string | null | undefined) ?? null;
  if (!(TIMEOUT_STEP_VAR in st.vars)) {
    // Execução antiga (sem a variável, gravada em modo lista): o passo anterior ao índice salvo é o wait_reply
    const prev = steps[run.step_index - 1];
    if (prev && prev.type === 'wait_reply') timeoutStepId = prev.on_timeout_step_id ?? null;
  }
  const target = stepIndexById(steps, timeoutStepId);
  if (target >= 0) {
    note(st, null, `sem resposta, indo para o passo ${steps[target].id}`);
    delete st.vars[TIMEOUT_STEP_VAR];
    delete st.vars[TEMPLATE_ROUTE_VAR];
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
        const locked = await claimBotLock(admin, raw.id, raw.organization_id);
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
  /** Conversa existente (iniciado pelo chat): a execução fica presa a ela e envia pelo número dela */
  conversationId?: string | null;
  /** Contexto adicional escrito pela equipe (vira {{contexto_extra}} nas mensagens e segue para o agente na entrega) */
  context?: string | null;
  /** Iniciado por outro robô: profundidade da cadeia (limite MAX_CHAIN_DEPTH) */
  chainDepth?: number;
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
    let phone = input.phone ? normalizePhoneE164(input.phone) : '';
    let dealId = input.dealId ?? null;
    let contactId = input.contactId ?? null;
    let conversationId: string | null = null;
    if (input.conversationId) {
      // Conversa existente: telefone, contato e negócio vêm dela quando não informados
      const { data, error } = await admin
        .from('wa_conversations')
        .select('id, wa_phone, contact_id, deal_id')
        .eq('organization_id', input.organizationId)
        .eq('id', input.conversationId)
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      const conv = data as { id: string; wa_phone: string | null; contact_id: string | null; deal_id: string | null } | null;
      if (!conv) return { ok: false, error: 'Conversa não encontrada' };
      conversationId = conv.id;
      phone = phone || (conv.wa_phone ? normalizePhoneE164(conv.wa_phone) : '');
      contactId = contactId ?? conv.contact_id ?? null;
      dealId = dealId ?? conv.deal_id ?? null;
    }
    if (!conversationId && !dealId && !contactId && !phone) {
      return { ok: false, error: 'Informe um negócio, um contato ou um telefone' };
    }
    const { data, error } = await admin
      .from('wa_bot_runs')
      .insert({
        organization_id: input.organizationId,
        bot_id: bot.id,
        deal_id: dealId,
        contact_id: contactId,
        conversation_id: conversationId,
        phone: phone || null,
        status: 'running',
        wake_at: nowIso(),
        step_index: 0,
        vars: {
          ...(input.context?.trim() ? { contexto_extra: input.context.trim() } : {}),
          ...(input.chainDepth ? { [CHAIN_DEPTH_VAR]: input.chainDepth } : {}),
        },
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
  const locked = await claimBotLock(admin, run.id, run.organization_id);
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
