/** Diagnostics for connecting ZapSign. Never log request bodies or credentials. */
export type ConnectionStage =
  | 'authorization' | 'validation' | 'client' | 'templates'
  | 'settings' | 'webhook_secret' | 'webhook' | 'persist';

export function logConnectionFailure(
  stage: ConnectionStage,
  reference: string,
  error: unknown,
  secrets: string[] = [],
): void {
  const value = error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown } | null;
  // Do not serialize the error object: provider bodies and DB details can contain credentials.
  let message = typeof value?.message === 'string' ? value.message : 'Unknown connection error';
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join('[redacted]');
  message = message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/\beyJ[A-Za-z0-9_.-]+/g, '[redacted]')
    .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
    .slice(0, 400);
  const code = typeof value?.code === 'string'
    && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(value.code)
    && !secrets.includes(value.code) ? value.code : undefined;
  const name = typeof value?.name === 'string' && /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|ZapSignError)$/.test(value.name) ? value.name : 'Error';
  console.error('[zapsign.connect]', { reference, stage, name, code, status: typeof value?.status === 'number' ? value.status : undefined, message });
}

export function connectionFailureMessage(stage: ConnectionStage, reference: string): string {
  const operation = stage === 'authorization' ? 'verificar sua sessão'
    : stage === 'persist' ? 'salvar a conexão'
      : stage === 'settings' ? 'ler a configuração da integração'
        : 'concluir a conexão';
  return `Não foi possível ${operation} da ZapSign. Referência: ${reference}. Informe esta referência ao suporte antes de tentar novamente.`;
}
