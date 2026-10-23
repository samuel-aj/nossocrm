export type UsageBlock = { conversationId: string; blockedAt: string; reason: string | null };
export type UsageBlockMap = Record<string, UsageBlock>;

const LIMIT_REASONS = new Set(['conversation_token_limit', 'conversation_audio_limit', 'organization_daily_token_limit']);

export function usageBlockLabel(reason: string | null) {
  return LIMIT_REASONS.has(reason ?? '') ? 'IA pausada por limite' : 'IA pausada por consumo';
}

/** The newest chat may be unblocked while another number shares a blocked account. */
export function firstUsageBlock(blocks: Array<UsageBlock | null | undefined>): UsageBlock | null {
  return blocks.filter((block): block is UsageBlock => !!block)
    .sort((a, b) => a.blockedAt.localeCompare(b.blockedAt) || a.conversationId.localeCompare(b.conversationId))[0] ?? null;
}
