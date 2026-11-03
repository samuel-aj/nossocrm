/**
 * Cliente HTTP da API4com (https://developers.api4com.com).
 *
 * - Base: https://api.api4com.com/api/v1
 * - Autenticação: token do USUÁRIO, puro (sem "Bearer"), no cabeçalho Authorization.
 * - Erros vêm no formato do LoopBack ({ error: { statusCode, code, message } }).
 * - POST /calls só responde depois que o Webphone do usuário atende (pode levar
 *   o tempo de toque), por isso o timeout dele é maior.
 */

export const API4COM_BASE = 'https://api.api4com.com/api/v1';

export class Api4comError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'Api4comError';
    this.status = status;
    this.code = code;
  }
}

export type Api4comMe = { uuid?: string; name?: string; email?: string; role?: string };
export type Api4comIntegration = {
  id?: number | string;
  gateway?: string;
  webhook?: boolean;
  webhookConstraint?: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
};
export type Api4comCallResponse = { status?: string; id?: string; message?: string };

export type Api4comClient = {
  /** Quem é o dono do token (valida o token). */
  me(): Promise<Api4comMe>;
  /** Integrações do usuário com esse gateway ("sippulse" = o ramal dele). */
  findIntegrations(gateway: string): Promise<Api4comIntegration[]>;
  /** Cria (sem id) ou atualiza (com id) a integração de webhook. */
  upsertIntegration(body: Record<string, unknown>): Promise<Api4comIntegration>;
  deleteIntegration(id: string | number): Promise<void>;
  /** Clique para ligar: toca no ramal do usuário e depois disca para o cliente. */
  call(input: { extension: string; called: string; metadata: Record<string, unknown> }): Promise<Api4comCallResponse>;
  hangup(callId: string): Promise<void>;
};

type FetchImpl = typeof fetch;

function errorDetails(data: unknown, status: number): { message: string; code: string | null } {
  const d = data as { error?: { message?: string; code?: string; name?: string } | string; message?: string; code?: string } | string | null;
  if (d && typeof d === 'object') {
    if (d.error && typeof d.error === 'object') return { message: d.error.message || d.error.name || `HTTP ${status}`, code: d.error.code ?? null };
    if (typeof d.error === 'string') return { message: d.error, code: d.code ?? null };
    if (d.message) return { message: d.message, code: d.code ?? null };
  }
  if (typeof d === 'string' && d.trim()) return { message: d.slice(0, 200), code: null };
  return { message: `HTTP ${status}`, code: null };
}

async function request<T>(fetchImpl: FetchImpl, token: string, method: string, path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${API4COM_BASE}${path}`, {
      method,
      headers: { Authorization: token, 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Api4comError('a API4com demorou demais para responder', 0, 'TIMEOUT');
    throw new Api4comError(`não foi possível falar com a API4com: ${(err as Error).message}`, 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const { message, code } = errorDetails(data, res.status);
    throw new Api4comError(message, res.status, code);
  }
  return data as T;
}

export function clientFor(token: string, fetchImpl: FetchImpl = fetch): Api4comClient {
  const t = token.trim();
  return {
    me: () => request<Api4comMe>(fetchImpl, t, 'GET', '/users/me'),
    findIntegrations: async (gateway) => {
      const list = await request<Api4comIntegration[] | { data?: Api4comIntegration[] }>(fetchImpl, t, 'GET', `/integrations?filter[where][gateway]=${encodeURIComponent(gateway)}`);
      if (Array.isArray(list)) return list;
      return Array.isArray(list?.data) ? list.data : [];
    },
    upsertIntegration: (body) => request<Api4comIntegration>(fetchImpl, t, 'PATCH', '/integrations', body),
    deleteIntegration: async (id) => {
      await request<unknown>(fetchImpl, t, 'DELETE', `/integrations/${encodeURIComponent(String(id))}`);
    },
    call: (input) =>
      request<Api4comCallResponse>(fetchImpl, t, 'POST', '/calls', { extension: input.extension, caller: input.extension, called: input.called, metadata: input.metadata }, 95_000),
    hangup: async (callId) => {
      await request<unknown>(fetchImpl, t, 'POST', `/calls/${encodeURIComponent(callId)}/hangup`, {});
    },
  };
}
