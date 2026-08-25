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
import type { AgentPublic, AgentRow } from '@/lib/wa-agents/types';

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

/** Remove a chave da API da linha e informa só se existe (nunca expor api_key). */
export function toAgentPublic(row: AgentRow): AgentPublic {
  const { api_key, ...rest } = row;
  return { ...rest, has_api_key: Boolean(api_key) };
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

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}
