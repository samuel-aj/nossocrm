export type NormalizedUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens: number | null;
  totalTokens: number;
};

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** SDK v3 totals already include cache and reasoning. Missing usage is never treated as zero. */
export function normalizeLanguageUsage(value: unknown): NormalizedUsage | null {
  const usage = record(value);
  const input = record(usage.inputTokens);
  const output = record(usage.outputTokens);
  const inputTokens = amount(input.total ?? usage.inputTokens);
  const outputTokens = amount(output.total ?? usage.outputTokens);
  if (inputTokens === null || outputTokens === null || !Number.isSafeInteger(inputTokens + outputTokens)) return null;
  const cachedInputTokens = amount(input.cacheRead ?? record(usage.inputTokenDetails).cacheReadTokens);
  const cacheWriteTokens = amount(input.cacheWrite ?? record(usage.inputTokenDetails).cacheWriteTokens);
  const reasoningTokens = amount(output.reasoning ?? record(usage.outputTokenDetails).reasoningTokens);
  if ((cachedInputTokens ?? 0) + (cacheWriteTokens ?? 0) > inputTokens || (reasoningTokens !== null && reasoningTokens > outputTokens)) return null;
  return { inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens, totalTokens: inputTokens + outputTokens };
}

export function normalizeEmbeddingUsage(value: unknown, rawResponse?: unknown): NormalizedUsage | null {
  // The installed Google adapter leaves usage undefined but preserves the provider's
  // documented EmbeddingUsageMetadata in response.body. Read its count, never the text.
  // https://ai.google.dev/api/embeddings#EmbeddingUsageMetadata
  const inputTokens = amount(record(value).tokens ?? record(record(rawResponse).usageMetadata).promptTokenCount);
  return inputTokens === null ? null : { inputTokens, outputTokens: 0, cachedInputTokens: null, reasoningTokens: null, totalTokens: inputTokens };
}
