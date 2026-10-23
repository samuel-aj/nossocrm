import type { NormalizedUsage } from './normalize';

export type TokenTariff = {
  version: string;
  provider: string;
  model: string;
  currency: 'USD';
  inputPerMillion: number;
  cachedInputPerMillion?: number;
  outputPerMillion: number;
};

export type CostEstimate = { estimatedCostUsd: number | null; pricingVersion: string | null };
export const PRICING_VERSION = '2026-10-23-standard-usd-v1';
const UNKNOWN_COST: CostEstimate = { estimatedCostUsd: null, pricingVersion: null };

// Standard direct-API list prices, USD per million tokens. Verified 2026-10-23.
// OpenAI: https://developers.openai.com/api/docs/models/{model-id}
// Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
// Google: https://ai.google.dev/gemini-api/docs/pricing
// Embedding 001: https://developers.googleblog.com/en/gemini-embedding-available-gemini-api/
// Only these exact model IDs are priced. Older snapshots, private deployments,
// regional/residency premiums and custom models must not inherit an alias's price.
const STANDARD_RATES: Record<string, readonly [input: number, cached: number | null, output: number]> = {
  'openai:gpt-4.1': [2, 0.5, 8],
  'openai:gpt-4.1-mini': [0.4, 0.1, 1.6],
  'openai:gpt-4o': [2.5, 1.25, 10],
  'openai:gpt-4o-mini': [0.15, 0.075, 0.6],
  'openai:gpt-5': [1.25, 0.125, 10],
  'openai:gpt-5-mini': [0.25, 0.025, 2],
  'openai:gpt-5.2': [1.75, 0.175, 14],
  'openai:text-embedding-3-small': [0.02, null, 0],
  'anthropic:claude-sonnet-4-5': [3, 0.3, 15],
  'anthropic:claude-haiku-4-5': [1, 0.1, 5],
  'anthropic:claude-opus-4-5': [5, 0.5, 25],
  'google:gemini-2.5-flash': [0.3, 0.03, 2.5],
  'google:gemini-2.5-flash-lite': [0.1, 0.01, 0.4],
  'google:gemini-2.5-pro': [1.25, 0.125, 10],
  'google:gemini-embedding-001': [0.15, null, 0],
};

export function tokenTariff(provider: string, model: string, usage: NormalizedUsage, operation?: string): TokenTariff | null {
  const rates = STANDARD_RATES[`${provider}:${model}`];
  if (!rates) return null;
  // Cache-write TTL affects Anthropic prices and is not recorded by our SDK contract.
  // Long-context 4.5 requests also require a separate tariff. Preserve unknown costs.
  if (provider === 'anthropic' && (usage.cacheWriteTokens !== 0 || usage.inputTokens > 200_000)) return null;
  // Gemini Flash audio has a different input rate. This SDK drops modality token
  // details, so mixed text/audio cannot be priced correctly from the total alone.
  if (provider === 'google' && operation === 'audio_understanding') return null;
  const [inputPerMillion, cachedInputPerMillion, outputPerMillion] = provider === 'google' && model === 'gemini-2.5-pro' && usage.inputTokens > 200_000
    ? [2.5, 0.25, 15] : rates;
  return { version: PRICING_VERSION, provider, model, currency: 'USD', inputPerMillion, outputPerMillion,
    ...(cachedInputPerMillion !== null ? { cachedInputPerMillion } : {}) };
}

/** No guessed tariffs: a verified, versioned tariff must be supplied explicitly. */
export function estimateTokenCost(usage: NormalizedUsage, tariff?: TokenTariff | null): CostEstimate {
  if (!tariff || !tariff.version || tariff.currency !== 'USD') return UNKNOWN_COST;
  const cached = usage.cachedInputTokens ?? 0;
  if (cached > 0 && tariff.cachedInputPerMillion == null) return UNKNOWN_COST;
  if ((usage.cacheWriteTokens ?? 0) > 0) return UNKNOWN_COST;
  const rates = [tariff.inputPerMillion, tariff.outputPerMillion, tariff.cachedInputPerMillion ?? 0];
  if (rates.some(value => !Number.isFinite(value) || value < 0)) return UNKNOWN_COST;
  return {
    estimatedCostUsd: ((usage.inputTokens - cached) * tariff.inputPerMillion + cached * (tariff.cachedInputPerMillion ?? 0) + usage.outputTokens * tariff.outputPerMillion) / 1_000_000,
    pricingVersion: tariff.version,
  };
}

export function estimateOperationCost(input: { provider: string; model: string; operation: string; usage: NormalizedUsage | number; standardPricing?: boolean }): CostEstimate {
  if (input.standardPricing === false) return UNKNOWN_COST;
  if (typeof input.usage !== 'number') return estimateTokenCost(input.usage, tokenTariff(input.provider, input.model, input.usage, input.operation));
  // https://developers.openai.com/api/docs/models/whisper-1 — $0.006/minute.
  // Based on reported audio duration; this remains an estimate, not an invoice.
  if (input.provider === 'openai' && input.model === 'whisper-1' && Number.isFinite(input.usage) && input.usage >= 0) {
    return { estimatedCostUsd: input.usage * 0.006 / 60, pricingVersion: PRICING_VERSION };
  }
  return UNKNOWN_COST;
}
