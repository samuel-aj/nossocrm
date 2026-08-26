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
  WA_AGENT_FILES_BUCKET,
  type AgentMediaKind,
  type AgentMediaRow,
  type AgentTriggers,
  type BotStep,
} from '@/lib/wa-agents/types';

/** Versão sem a chave da API (has_api_key): implementação única em types.ts. */
export { toAgentPublic } from '@/lib/wa-agents/types';

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

/**
 * Valida os agentes auxiliares: cada id precisa ser da org, estar ligado e ser
 * diferente do próprio agente (`selfId`, no PATCH). null quando ok.
 */
export async function validateHelperAgentIds(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
  selfId?: string | null
): Promise<Response | null> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (selfId && unique.includes(selfId)) {
    return validationMessage('O agente não pode ser auxiliar de si mesmo', 'helper_agent_ids');
  }
  if (unique.length === 0) return null;
  const { data, error } = await admin
    .from('wa_ai_agents')
    .select('id, enabled')
    .eq('organization_id', orgId)
    .in('id', unique);
  if (error) throw new Error(error.message);
  const found = new Map(((data ?? []) as Array<{ id: string; enabled: boolean }>).map(r => [r.id, r.enabled]));
  for (const id of unique) {
    if (!found.has(id)) return validationMessage('Agente auxiliar não encontrado nesta organização', 'helper_agent_ids');
    if (found.get(id) === false) return validationMessage('Agente auxiliar desligado: ligue-o antes de usá-lo', 'helper_agent_ids');
  }
  return null;
}

/** Ids únicos, na ordem recebida. */
export function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

/** Mime coerente com a categoria da mídia (documento aceita qualquer tipo). */
export function mediaMimeMatchesKind(kind: AgentMediaKind, mime: string): boolean {
  const m = (mime || '').toLowerCase();
  if (kind === 'document' || !m) return true;
  return m.startsWith(`${kind}/`);
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

/**
 * Passos do robô: o passo inicial (modo quadro) e todo id referenciado
 * (next_step_id, goto_step_id, else_step_id, on_timeout_step_id) precisam
 * existir na lista de passos. null quando ok.
 */
export function validateBotSteps(steps: BotStep[], startStepId: string | null | undefined): Response | null {
  const ids = new Set(steps.map(s => s.id));
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
  return null;
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}
