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
