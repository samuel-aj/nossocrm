/**
 * Helpers compartilhados pelas rotas /api/wa-agents/* (beta de agentes de IA).
 *
 * Padrão do projeto: autentica pela sessão (cookie) e opera via client admin
 * (service role) filtrando SEMPRE por organization_id. Mutações exigem mesma
 * origem (CSRF) e quase tudo exige a chave beta ligada na organização
 * (exceto /beta e as rotas internas chamadas pelo banco).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodError } from 'zod';
import { requireOrgUser, isOrgAdmin, json, type OrgUser } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isWaAgentsBetaEnabled } from '@/lib/wa-agents/beta';
import { normalizeKeyword } from '@/lib/wa-agents/text';
import {
  isAllowedMediaMime,
  isMaskedSecret,
  WA_AGENT_FILES_BUCKET,
  type AgentInput,
  type AgentMediaKind,
  type AgentMediaRow,
  type AgentRow,
  type AgentTriggers,
  type BotLayout,
  type BotStep,
  type EndAction,
} from '@/lib/wa-agents/types';

/** Versões para a UI (sem chave da API, segredos mascarados): implementação única em types.ts. */
export { toAgentPublic, toBotPublic } from '@/lib/wa-agents/types';

function savedActionSecret(saved: EndAction[] | undefined, index: number, url: string): string | null {
  const list = saved ?? [];
  const same = list[index];
  if (same && same.type === 'webhook' && same.url === url) return same.secret ?? null;
  const byUrl = list.find(a => a.type === 'webhook' && a.url === url);
  return byUrl && byUrl.type === 'webhook' ? (byUrl.secret ?? null) : null;
}

function restoreActionSecrets(actions: EndAction[] | undefined, saved: EndAction[] | undefined): EndAction[] {
  return (actions ?? []).map((a, i) =>
    a.type === 'webhook' && isMaskedSecret(a.secret) ? { ...a, secret: savedActionSecret(saved, i, a.url) } : a
  );
}

/**
 * Segredos mascarados que a UI devolveu sem alterar viram o valor salvo:
 * webhooks por id; ações de resultados/ações durante a conversa pela chave e
 * posição (ou URL). Sem valor salvo (criação), o segredo fica vazio.
 */
export function restoreMaskedSecrets(incoming: Partial<AgentInput>, saved: AgentRow | null): Partial<AgentInput> {
  const out: Partial<AgentInput> = { ...incoming };
  if (Array.isArray(incoming.webhooks)) {
    const byId = new Map((saved?.webhooks ?? []).map(w => [w.id, w]));
    out.webhooks = incoming.webhooks.map(w => (isMaskedSecret(w.secret) ? { ...w, secret: byId.get(w.id)?.secret ?? null } : w));
  }
  if (Array.isArray(incoming.outcomes)) {
    const byKey = new Map((saved?.outcomes ?? []).map(o => [o.key, o]));
    out.outcomes = incoming.outcomes.map(o => ({ ...o, actions: restoreActionSecrets(o.actions, byKey.get(o.key)?.actions) }));
  }
  if (Array.isArray(incoming.custom_actions)) {
    const byKey = new Map((saved?.custom_actions ?? []).map(c => [c.key, c]));
    out.custom_actions = incoming.custom_actions.map(c => ({ ...c, actions: restoreActionSecrets(c.actions, byKey.get(c.key)?.actions) }));
  }
  return out;
}

/** Passos do robô: segredo mascarado do passo webhook volta ao valor salvo (pelo id do passo). */
export function restoreMaskedBotSecrets(steps: BotStep[], saved: BotStep[] | null | undefined): BotStep[] {
  const byId = new Map((saved ?? []).map(s => [s.id, s]));
  return steps.map(s => {
    if (s.type !== 'webhook' || !isMaskedSecret(s.secret)) return s;
    const prev = byId.get(s.id);
    return { ...s, secret: prev && prev.type === 'webhook' ? (prev.secret ?? null) : null };
  });
}

export type GuardResult =
  | { ok: true; user: OrgUser; admin: SupabaseClient; isAdmin: boolean }
  | { ok: false; response: Response };

export interface GuardOptions {
  /** Requisição de mutação: valida a origem (mitigação de CSRF). */
  req?: Request;
  /** Exige papel de administrador da organização. */
  admin?: boolean;
  /** Exige a chave beta ligada na organização (padrão: true). */
  beta?: boolean;
}

/** Autentica, checa origem/papel/beta e devolve usuário + client admin. */
export async function guardRoute(opts: GuardOptions = {}): Promise<GuardResult> {
  if (opts.req && !isAllowedOrigin(opts.req)) {
    return { ok: false, response: json({ error: 'Origem não permitida' }, 403) };
  }
  const auth = await requireOrgUser();
  if (!auth.ok) return auth;

  const isAdmin = isOrgAdmin(auth.user.role);
  if (opts.admin && !isAdmin) {
    return {
      ok: false,
      response: json({ error: 'Apenas administradores podem fazer isso', code: 'FORBIDDEN' }, 403),
    };
  }
  if (opts.beta !== false) {
    const enabled = await isWaAgentsBetaEnabled(auth.admin, auth.user.organizationId);
    if (!enabled) {
      return { ok: false, response: json({ error: 'Versão beta desativada', code: 'BETA_DISABLED' }, 403) };
    }
  }
  return { ok: true, user: auth.user, admin: auth.admin, isAdmin };
}

/** Resposta padrão para erro de validação zod. */
export function validationError(error: ZodError): Response {
  return json({ error: 'Dados inválidos', code: 'VALIDATION_ERROR', issues: error.issues }, 400);
}

/** Erro de validação de uma regra de negócio (mesmo formato do zod: issues com path e message). */
export function validationMessage(message: string, path: string): Response {
  return json(
    { error: 'Dados inválidos', code: 'VALIDATION_ERROR', issues: [{ code: 'custom', path: path.split('.'), message }] },
    400
  );
}

/** Lê o JSON do corpo sem lançar (null quando inválido ou vazio). */
export async function readJsonBody(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

/** Query string como objeto, ignorando parâmetros vazios. */
export function searchParamsToObject(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URL(req.url).searchParams.entries()) {
    if (value.trim() !== '') out[key] = value;
  }
  return out;
}

/**
 * Mantém só as chaves que vieram no corpo da requisição. Necessário porque o
 * zod v4 aplica os defaults mesmo em `.partial()`, o que faria um PATCH parcial
 * zerar campos não enviados (roteiro, resultados, etc.).
 */
export function pickPresentKeys<T extends Record<string, unknown>>(raw: unknown, parsed: T): Partial<T> {
  const out: Partial<T> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(parsed) as Array<keyof T>) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) out[key] = parsed[key];
  }
  return out;
}

/**
 * Normaliza a chave da API vinda do formulário:
 * - undefined ou valor mascarado (começa com quatro pontos) -> undefined (não mexe)
 * - null ou '' -> null (limpa)
 * - texto -> texto sem espaços nas pontas
 */
export function normalizeApiKeyInput(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('••••')) return undefined;
  return trimmed;
}

/** true quando todos os ids são números (wa_connections) da organização. Lista vazia passa. */
export async function connectionsBelongToOrg(admin: SupabaseClient, orgId: string, ids: string[]): Promise<boolean> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return true;
  const { data, error } = await admin.from('wa_connections').select('id').eq('organization_id', orgId).in('id', unique);
  if (error) throw new Error(error.message);
  return (data ?? []).length === unique.length;
}

/** Resposta padrão quando um número informado não é da organização. */
export function connectionNotFoundError(): Response {
  return json({ error: 'Número não encontrado nesta organização', code: 'CONNECTION_NOT_FOUND' }, 400);
}

/** true quando o agente existe na organização. */
export async function agentBelongsToOrg(admin: SupabaseClient, orgId: string, agentId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('wa_ai_agents')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', agentId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Resposta padrão quando o agente não existe na organização. */
export function agentNotFoundError(): Response {
  return json({ error: 'Agente não encontrado', code: 'AGENT_NOT_FOUND' }, 404);
}

export type HelperIdsResult = { ok: true; ids: string[] } | { ok: false; response: Response };

/**
 * Valida os agentes auxiliares: cada id precisa ser da org e estar ligado e
 * ser diferente do próprio agente (`selfId`, no PATCH). Ids que não existem
 * mais (agente excluído) são descartados em silêncio, senão a lista ficaria
 * impossível de editar; auxiliar desligado continua sendo erro.
 */
export async function validateHelperAgentIds(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
  selfId?: string | null
): Promise<HelperIdsResult> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (selfId && unique.includes(selfId)) {
    return { ok: false, response: validationMessage('O agente não pode ser auxiliar de si mesmo', 'helper_agent_ids') };
  }
  if (unique.length === 0) return { ok: true, ids: [] };
  const { data, error } = await admin
    .from('wa_ai_agents')
    .select('id, enabled')
    .eq('organization_id', orgId)
    .in('id', unique);
  if (error) throw new Error(error.message);
  const found = new Map(((data ?? []) as Array<{ id: string; enabled: boolean }>).map(r => [r.id, r.enabled]));
  const kept: string[] = [];
  for (const id of unique) {
    if (!found.has(id)) continue;
    if (found.get(id) === false) {
      return { ok: false, response: validationMessage('Agente auxiliar desligado: ligue-o antes de usá-lo', 'helper_agent_ids') };
    }
    kept.push(id);
  }
  return { ok: true, ids: kept };
}

/** Tira `agentId` da lista de auxiliares dos outros agentes da org (agente excluído). */
export async function removeHelperReferences(admin: SupabaseClient, orgId: string, agentId: string): Promise<void> {
  const { data, error } = await admin
    .from('wa_ai_agents')
    .select('id, helper_agent_ids')
    .eq('organization_id', orgId)
    .contains('helper_agent_ids', [agentId]);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as Array<{ id: string; helper_agent_ids: string[] | null }>) {
    const next = (row.helper_agent_ids ?? []).filter(x => x !== agentId);
    const { error: upError } = await admin
      .from('wa_ai_agents')
      .update({ helper_agent_ids: next, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('id', row.id);
    if (upError) throw new Error(upError.message);
  }
}

/** Ids únicos, na ordem recebida. */
export function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

/** Mime aceito para a categoria da mídia (lista fechada por categoria em AGENT_MEDIA_MIMES). */
export function mediaMimeMatchesKind(kind: AgentMediaKind, mime: string): boolean {
  return isAllowedMediaMime(kind, mime);
}

/** true quando já existe outra mídia com o mesmo nome (sem acento/caixa) na lista. */
export function mediaNameTaken(media: AgentMediaRow[], name: string, exceptId?: string | null): boolean {
  const key = normalizeKeyword(name);
  return media.some(m => m.id !== exceptId && normalizeKeyword(m.name) === key);
}

/** Apaga arquivos do bucket wa-agent-files (melhor esforço: erros só vão para o log). */
export async function removeAgentFiles(admin: SupabaseClient, paths: string[]): Promise<void> {
  const list = paths.filter(Boolean);
  if (list.length === 0) return;
  try {
    const { error } = await admin.storage.from(WA_AGENT_FILES_BUCKET).remove(list);
    if (error) console.error('[wa-agents] apagar arquivos do agente falhou:', error.message);
  } catch (err) {
    console.error('[wa-agents] apagar arquivos do agente falhou:', getErrorMessage(err, 'erro desconhecido'));
  }
}

/** true quando a etapa (board_stages) é da organização (e do quadro, quando informado). */
export async function stageBelongsToOrg(
  admin: SupabaseClient,
  orgId: string,
  stageId: string,
  boardId?: string | null
): Promise<boolean> {
  let q = admin.from('board_stages').select('id').eq('organization_id', orgId).eq('id', stageId);
  if (boardId) q = q.eq('board_id', boardId);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** true quando o quadro (boards) é da organização e não foi apagado. */
export async function boardBelongsToOrg(admin: SupabaseClient, orgId: string, boardId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('boards')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', boardId)
    .is('deleted_at', null)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Valida os gatilhos do agente quando o gatilho por pipeline está ligado:
 * quadro (quando informado) da org, etapa obrigatória (e da org) para
 * "entrou numa etapa" e número que inicia a conversa obrigatório e da org.
 * null quando está tudo certo.
 */
export async function validateAgentTriggers(
  admin: SupabaseClient,
  orgId: string,
  triggers: AgentTriggers
): Promise<Response | null> {
  const deal = triggers.deal;
  if (!deal.enabled) return null;
  if (deal.board_id && !(await boardBelongsToOrg(admin, orgId, deal.board_id))) {
    return validationMessage('Quadro não encontrado nesta organização', 'triggers.deal.board_id');
  }
  if (deal.event === 'deal_stage_entered') {
    if (!deal.stage_id) return validationMessage('Informe a etapa do gatilho "entrou numa etapa"', 'triggers.deal.stage_id');
    if (!(await stageBelongsToOrg(admin, orgId, deal.stage_id, deal.board_id))) {
      return validationMessage('Etapa não encontrada nesta organização', 'triggers.deal.stage_id');
    }
  }
  if (!deal.connection_id) {
    return validationMessage('Informe o número que inicia a conversa', 'triggers.deal.connection_id');
  }
  if (!(await connectionsBelongToOrg(admin, orgId, [deal.connection_id]))) return connectionNotFoundError();
  return null;
}

/** Ids de passos referenciados por um passo (próximo, regras da condição, senão, sem resposta). */
function botStepReferences(step: BotStep): Array<{ field: string; id: string }> {
  const refs: Array<{ field: string; id: string }> = [];
  if (step.next_step_id) refs.push({ field: 'next_step_id', id: step.next_step_id });
  if (step.type === 'condition') {
    step.rules.forEach((rule, i) => {
      if (rule.goto_step_id) refs.push({ field: `rules.${i}.goto_step_id`, id: rule.goto_step_id });
    });
    if (step.else_step_id) refs.push({ field: 'else_step_id', id: step.else_step_id });
  }
  if (step.type === 'wait_reply' && step.on_timeout_step_id) {
    refs.push({ field: 'on_timeout_step_id', id: step.on_timeout_step_id });
  }
  return refs;
}

const BOT_STEP_LABELS: Record<BotStep['type'], string> = {
  send_text: 'Mensagem',
  send_template: 'Modelo de mensagem',
  wait: 'Esperar',
  wait_reply: 'Esperar resposta',
  condition: 'Condição',
  move_stage: 'Mover etapa',
  add_tag: 'Rótulo',
  webhook: 'Webhook',
  handoff_agent: 'Entregar a agente',
  end: 'Encerrar',
};

/** Blocos com uma única saída: podem ficar em qualquer posição do balão. */
const LINEAR_BOT_STEP_TYPES = new Set<BotStep['type']>(['send_text', 'send_template', 'wait', 'move_stage', 'add_tag', 'webhook']);

/**
 * Passos do robô:
 * - o passo inicial (modo quadro) e todo id referenciado (next_step_id,
 *   goto_step_id, else_step_id, on_timeout_step_id) precisam existir na lista;
 * - balões (layout.groups): todo step_id existe, cada passo está em no máximo
 *   um balão, blocos com várias saídas ou terminais só podem ser o último do
 *   balão e o encadeamento interno bate com next_step_id (o editor é quem
 *   garante isso; aqui só se rejeita inconsistência);
 * - ligar o robô (enabled) exige ao menos um passo e, no modo quadro, o passo
 *   inicial ligado ao gatilho. Robô sem passos pode ser salvo desligado (rascunho).
 * null quando ok.
 */
export function validateBotSteps(
  steps: BotStep[],
  startStepId: string | null | undefined,
  layout: BotLayout | null | undefined,
  enabled: boolean
): Response | null {
  const ids = new Set(steps.map(s => s.id));
  const byId = new Map(steps.map(s => [s.id, s]));
  const indexById = new Map(steps.map((s, i) => [s.id, i]));
  if (startStepId && !ids.has(startStepId)) {
    return validationMessage('O passo inicial do quadro não existe na lista de passos', 'start_step_id');
  }
  for (let i = 0; i < steps.length; i++) {
    for (const ref of botStepReferences(steps[i])) {
      if (!ids.has(ref.id)) {
        return validationMessage(
          `O passo "${steps[i].id}" aponta para um passo que não existe ("${ref.id}")`,
          `steps.${i}.${ref.field}`
        );
      }
    }
  }

  const groups = layout?.groups ?? [];
  const seen = new Set<string>();
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const name = group.name?.trim() || `Balão ${gi + 1}`;
    const stepIds = group.step_ids ?? [];
    for (let si = 0; si < stepIds.length; si++) {
      const stepId = stepIds[si];
      if (!ids.has(stepId)) {
        return validationMessage(`O balão "${name}" aponta para um passo que não existe ("${stepId}")`, `layout.groups.${gi}.step_ids.${si}`);
      }
      if (seen.has(stepId)) {
        return validationMessage(`O passo "${stepId}" está em mais de um balão`, `layout.groups.${gi}.step_ids.${si}`);
      }
      seen.add(stepId);
    }
    for (let si = 0; si < stepIds.length - 1; si++) {
      const step = byId.get(stepIds[si]);
      if (!step) continue;
      const index = indexById.get(step.id) ?? 0;
      if (!LINEAR_BOT_STEP_TYPES.has(step.type)) {
        return validationMessage(
          `No balão "${name}", o bloco "${BOT_STEP_LABELS[step.type]}" só pode ser o último`,
          `layout.groups.${gi}.step_ids.${si}`
        );
      }
      const expected = stepIds[si + 1];
      if ((step.next_step_id ?? null) !== expected) {
        return validationMessage(
          `No balão "${name}", o passo "${step.id}" deveria seguir para "${expected}" (ordem do balão)`,
          `steps.${index}.next_step_id`
        );
      }
    }
  }

  if (enabled) {
    if (steps.length === 0) {
      return validationMessage(
        'O robô está vazio: adicione ao menos um balão ligado ao gatilho antes de ligá-lo (ou salve desligado, como rascunho)',
        'enabled'
      );
    }
    const canvasMode = groups.length > 0 || steps.some(s => s.ui !== undefined || s.next_step_id !== undefined);
    if (canvasMode && !startStepId) {
      return validationMessage(
        'Ligue a saída "Então" do gatilho ao primeiro balão antes de ligar o robô (ou salve desligado, como rascunho)',
        'start_step_id'
      );
    }
  }
  return null;
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}
