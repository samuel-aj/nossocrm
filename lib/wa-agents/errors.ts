/**
 * Erro tipado do motor de agentes. `code` é estável para a UI/rotas decidirem
 * o que mostrar (ex.: AI_KEY_NOT_CONFIGURED).
 */
export class WaAgentError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WaAgentError';
    this.code = code;
  }
}

/** Preserve the database reason after a run is recorded and its Error object is gone. */
export function dbFailure(error: { message: string; code?: string }): WaAgentError {
  const reason = error.code ? `[${error.code}] ${error.message}` : error.message;
  return new WaAgentError('DB_ERROR', reason);
}

/** Mensagem legível de qualquer erro (nunca lança). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
