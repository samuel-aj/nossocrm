/**
 * Mensagem de erro que pode ir para o navegador.
 *
 * Erro do banco (PostgREST / Postgres) traz nome de tabela, coluna, regra
 * interna e às vezes o próprio dado ("Key (email)=(fulano@x.com) already
 * exists"). Isso fica só no log do servidor; o navegador recebe uma frase
 * amigável (auditoria de segurança de 23/11/2026, item "dados sensíveis na
 * interface"). Erros escritos pelo próprio CRM ou por integrações (ex.: "Token
 * da Meta inválido") continuam passando como estão.
 */

const DB_CODE = /^([0-9A-Z]{5}|PGRST\d{3})$/;

const FRIENDLY: Record<string, string> = {
  '23505': 'Já existe um registro com esses dados.',
  '23503': 'Este registro está ligado a outro e não pode ser alterado desse jeito.',
  '23502': 'Falta preencher um campo obrigatório.',
  '23514': 'Algum dado informado não é válido.',
  '22P02': 'Algum dado está em formato inválido.',
  '22001': 'Algum texto passou do tamanho permitido.',
  '42501': 'Você não tem permissão para esta ação.',
  '57014': 'A operação demorou demais. Tente novamente.',
  PGRST116: 'Registro não encontrado.',
};

export const GENERIC_ERROR_MESSAGE = 'Não foi possível concluir a operação. Tente novamente.';

/** true para erro vindo do banco (supabase-js ou pg), que nunca deve ir cru para o navegador. */
export function isDatabaseError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (typeof e.code !== 'string' || !DB_CODE.test(e.code)) return false;
  return 'details' in e || 'hint' in e || 'detail' in e || 'schema' in e || 'table' in e;
}

export function safeErrorMessage(err: unknown, fallback: string = GENERIC_ERROR_MESSAGE): string {
  if (isDatabaseError(err)) {
    const e = err as { code: string; message?: unknown };
    console.error('[db-error]', e.code, typeof e.message === 'string' ? e.message : '');
    return FRIENDLY[e.code] ?? fallback;
  }
  if (typeof err === 'string') return err || fallback;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message || fallback;
  }
  return fallback;
}
