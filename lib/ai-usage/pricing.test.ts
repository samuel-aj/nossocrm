// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG } from '@/lib/wa-agents/catalog';
import { normalizeLanguageUsage, type NormalizedUsage } from './normalize';
import { estimateOperationCost, PRICING_VERSION, tokenTariff } from './pricing';

const usage: NormalizedUsage = { inputTokens: 1_000, outputTokens: 200, cachedInputTokens: 400, cacheWriteTokens: 0, reasoningTokens: 80, totalTokens: 1_200 };
const cost = (provider: string, model: string, value: NormalizedUsage | number = usage, operation = 'reply') => estimateOperationCost({ provider, model, operation, usage: value });

describe('verified standard direct-API price estimates', () => {
  it('covers every model offered by the existing agent editor with a dated tariff', () => {
    for (const [provider, models] of Object.entries(MODEL_CATALOG)) {
      for (const model of models) expect(tokenTariff(provider, model.id, usage)?.version).toBe(PRICING_VERSION);
    }
  });

  it('prices cache once and includes reasoning inside the output total once', () => {
    const result = cost('openai', 'gpt-4.1-mini');
    expect(result.estimatedCostUsd).toBeCloseTo((600 * 0.4 + 400 * 0.1 + 200 * 1.6) / 1_000_000, 10);
    expect(result.pricingVersion).toBe(PRICING_VERSION);
  });

  it('uses the verified rates for each vendor', () => {
    expect(cost('anthropic', 'claude-sonnet-4-5').estimatedCostUsd).toBeCloseTo((600 * 3 + 400 * 0.3 + 200 * 15) / 1_000_000, 10);
    expect(cost('google', 'gemini-2.5-flash').estimatedCostUsd).toBeCloseTo((600 * 0.3 + 400 * 0.03 + 200 * 2.5) / 1_000_000, 10);
  });

  it('applies the Gemini Pro long-input tier to the entire request', () => {
    const short = { ...usage, inputTokens: 200_000, totalTokens: 200_200 };
    const long = { ...usage, inputTokens: 200_001, totalTokens: 200_201 };
    expect(tokenTariff('google', 'gemini-2.5-pro', short)?.inputPerMillion).toBe(1.25);
    expect(cost('google', 'gemini-2.5-pro', long).estimatedCostUsd).toBeCloseTo((199_601 * 2.5 + 400 * 0.25 + 200 * 15) / 1_000_000, 10);
  });

  it('does not invent Anthropic cache-write TTL or a legacy long-context tariff', () => {
    expect(cost('anthropic', 'claude-sonnet-4-5', { ...usage, cacheWriteTokens: 100 }).estimatedCostUsd).toBeNull();
    expect(cost('anthropic', 'claude-sonnet-4-5', { ...usage, cacheWriteTokens: null }).estimatedCostUsd).toBeNull();
    expect(cost('anthropic', 'claude-sonnet-4-5', { ...usage, inputTokens: 200_001 }).estimatedCostUsd).toBeNull();
    const normalized = normalizeLanguageUsage({ inputTokens: { total: 1_000, cacheRead: 400, cacheWrite: 100 }, outputTokens: { total: 200, reasoning: 80 } })!;
    expect(normalized.totalTokens).toBe(1_200);
    expect(normalized.cacheWriteTokens).toBe(100);
    expect(cost('anthropic', 'claude-sonnet-4-5', normalized).estimatedCostUsd).toBeNull();
  });

  it('does not price mixed Gemini audio as text when modality counts are unavailable', () => {
    expect(cost('google', 'gemini-2.5-flash', usage, 'audio_understanding').estimatedCostUsd).toBeNull();
  });

  it('keeps unknown models, older snapshots and nonstandard service tiers unavailable', () => {
    expect(cost('openai', 'custom-model').estimatedCostUsd).toBeNull();
    expect(cost('openai', 'gpt-4o-2024-05-13').estimatedCostUsd).toBeNull();
    expect(estimateOperationCost({ provider: 'openai', model: 'gpt-4.1-mini', operation: 'reply', usage, standardPricing: false }).estimatedCostUsd).toBeNull();
  });

  it('estimates embeddings without adding output, cache or a second token count', () => {
    const embedding = { ...usage, inputTokens: 1_000, outputTokens: 0, cachedInputTokens: null, reasoningTokens: null, totalTokens: 1_000 };
    expect(cost('openai', 'text-embedding-3-small', embedding).estimatedCostUsd).toBeCloseTo(0.00002, 10);
    expect(cost('google', 'gemini-embedding-001', embedding).estimatedCostUsd).toBeCloseTo(0.00015, 10);
  });

  it('estimates Whisper from provider duration without converting audio to tokens', () => {
    expect(cost('openai', 'whisper-1', 10.5, 'audio_transcription')).toEqual({ estimatedCostUsd: 0.00105, pricingVersion: PRICING_VERSION });
    expect(cost('other', 'audio', 60).estimatedCostUsd).toBeNull();
  });
});
