export type UsageBlock = { conversationId: string; blockedAt: string; reason: string | null };
export type UsageBlockMap = Record<string, UsageBlock>;

const LIMIT_REASONS = new Set(['conversation_token_limit', 'conversation_audio_limit', 'organization_daily_token_limit']);

function canonicalReason(reason: string | null | undefined): string {
  const value = reason?.trim().toLowerCase() ?? '';
  return value === 'ai_usage_unknown' ? 'usage_unknown' : value;
}

export function usageBlockLabel(reason: string | null | undefined) {
  const value = canonicalReason(reason);
  if (value === 'provider_insufficient_quota') return 'IA pausada: limite da API';
  if (value === 'usage_unknown') return 'IA pausada: consumo pendente';
  return LIMIT_REASONS.has(value) ? 'IA pausada por limite' : 'IA pausada por consumo';
}

/** The persisted cause is independent of the current balance and remains until manual release. */
export function usageBlockDescription(reason: string | null | undefined): string {
  const labels: Record<string, string> = {
    conversation_token_limit: 'A próxima operação não cabe no saldo de tokens desta conversa.',
    conversation_audio_limit: 'A próxima transcrição não cabe na quota de áudio desta conversa.',
    audio_limit_not_configured: 'A quota de transcrição de áudio ainda não foi configurada.',
    organization_daily_token_limit: 'O limite de tokens da organização nas últimas 24 horas foi atingido.',
    usage_unknown: 'O provedor não confirmou o consumo de uma operação. A pausa exige revisão manual, mesmo havendo saldo de tokens no CRM.',
    provider_insufficient_quota: 'O provedor recusou a chamada por falta de créditos ou por um limite da conta da API. Regularize os créditos ou o limite da conta no provedor; aumentar o limite de tokens no CRM não resolve essa recusa.',
    unsupported_usage_bound: 'Este modelo ou operação não permite reservar um limite seguro de consumo.',
    usage_bound_exceeded: 'O consumo informado pelo provedor excedeu a reserva prevista.',
  };
  return labels[canonicalReason(reason)] ?? 'Não foi possível autorizar uma nova operação dentro das regras de consumo.';
}

export function usageBlockResumeMessage(reason: string | null | undefined): string {
  const instruction = LIMIT_REASONS.has(canonicalReason(reason))
    ? 'O responsável deve liberar saldo antes de retomar.'
    : 'O responsável deve revisar e liberar a pausa antes de retomar.';
  return `${usageBlockDescription(reason)} ${instruction}`;
}

/** The newest chat may be unblocked while another number shares a blocked account. */
export function firstUsageBlock(blocks: Array<UsageBlock | null | undefined>): UsageBlock | null {
  return blocks.filter((block): block is UsageBlock => !!block)
    .sort((a, b) => a.blockedAt.localeCompare(b.blockedAt) || a.conversationId.localeCompare(b.conversationId))[0] ?? null;
}
