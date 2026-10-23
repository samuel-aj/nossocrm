// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { embedMany, generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import type { LanguageModelV3, LanguageModelV3GenerateResult, EmbeddingModelV3 } from '@ai-sdk/provider';
import { assertUsageHealthy, getUsageContext, runWithUsageContext } from './context';
import { meterEmbeddingModel, meterLanguageModel, meteredOperation, textInputBound } from './meteredModel';
import { normalizeLanguageUsage, normalizeEmbeddingUsage } from './normalize';
import { estimateTokenCost } from './pricing';
import type { UsageContext } from './types';

const h = vi.hoisted(() => ({ reserve: vi.fn(), dispatch: vi.fn(), settle: vi.fn(), block: vi.fn() }));
vi.mock('./budget', () => ({ reserveUsage: h.reserve, dispatchUsage: h.dispatch, settleUsage: h.settle, blockConversationBudget: h.block }));
const context = (org = 'org-a'): UsageContext => ({ admin: {} as never, organizationId: org, conversationId: 'conversation', accountId: 'account', agentId: 'agent', runId: null, dealId: null, scope: 'conversation', policyEnabled: true });
const usage = { inputTokens: { total: 20, noCache: 12, cacheRead: 8, cacheWrite: 0 }, outputTokens: { total: 10, text: 7, reasoning: 3 } };
const reply = (): LanguageModelV3GenerateResult => ({ content: [{ type: 'text', text: 'Resposta fictícia' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] });
function model(generate = vi.fn(async () => reply())): LanguageModelV3 {
  return { specificationVersion: 'v3', provider: 'openai.responses', modelId: 'gpt-4.1-mini', supportedUrls: {}, doGenerate: generate, doStream: vi.fn() };
}
const metered = (m: LanguageModelV3, operation = 'reply') => meterLanguageModel(m, { provider: 'openai', modelId: 'gpt-4.1-mini', operation });
beforeEach(() => {
  vi.clearAllMocks();
  h.reserve.mockImplementation(async (_ctx, input) => ({ allowed: true, replay: false, attempt_id: input.idempotencyKey, status: 'reserved' }));
  h.dispatch.mockResolvedValue(true); h.settle.mockResolvedValue(undefined); h.block.mockResolvedValue(undefined);
});

describe('provider-call metering (all providers mocked)', () => {
  it('requires a context before dispatch, even if a caller forgets to establish one', async () => {
    const provider = vi.fn(async () => reply());
    await expect(generateText({ model: metered(model(provider)), prompt: 'test', maxRetries: 0 })).rejects.toThrow('autorizar');
    expect(provider).not.toHaveBeenCalled();
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it('reserves, dispatches and settles actual totals without duplicating cache/reasoning', async () => {
    const provider = vi.fn(async () => reply());
    await runWithUsageContext(context(), () => generateText({ model: metered(model(provider)), prompt: 'test', maxRetries: 0, maxOutputTokens: 60 }));
    expect(h.reserve).toHaveBeenCalledTimes(1);
    expect(h.reserve.mock.calls[0][1]).toMatchObject({ operation: 'reply', unit: 'tokens', metadata: { outputBound: 60 } });
    expect(h.settle.mock.calls[0][2]).toMatchObject({ status: 'completed', actualAmount: 30, totalTokens: 30, cachedInputTokens: 8, reasoningTokens: 3 });
    expect(h.settle.mock.calls[0][2].estimatedCostUsd).toBeCloseTo(0.0000216, 10);
    expect(provider.mock.invocationCallOrder[0]).toBeGreaterThan(h.dispatch.mock.invocationCallOrder[0]);
  });

  it('denied reservations and DB outages never call the paid provider', async () => {
    const provider = vi.fn(async () => reply());
    h.reserve.mockResolvedValueOnce({ allowed: false, replay: false, reason: 'quota', attempt_id: null });
    await expect(runWithUsageContext(context(), () => generateText({ model: metered(model(provider)), prompt: 'x', maxRetries: 0 }))).rejects.toThrow('quota');
    h.reserve.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(runWithUsageContext(context(), () => generateText({ model: metered(model(provider)), prompt: 'x', maxRetries: 0 }))).rejects.toThrow('database');
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not dispatch an idempotent replay or a failed dispatch claim', async () => {
    const provider = vi.fn(async () => reply());
    h.reserve.mockResolvedValueOnce({ allowed: true, replay: true, attempt_id: 'existing' });
    await expect(runWithUsageContext(context(), () => generateText({ model: metered(model(provider)), prompt: 'x', maxRetries: 0 }))).rejects.toThrow();
    h.dispatch.mockResolvedValueOnce(false);
    await expect(runWithUsageContext(context(), () => generateText({ model: metered(model(provider)), prompt: 'x', maxRetries: 0 }))).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });

  it('keeps unknown usage reserved and sticky across swallowed helper failures', async () => {
    const provider = vi.fn(async () => ({ ...reply(), usage: { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined } } }));
    await runWithUsageContext(context(), async () => {
      await expect(generateText({ model: metered(model(provider)), prompt: 'x', maxRetries: 0 })).rejects.toThrow('confirmação');
      expect(() => assertUsageHealthy()).toThrow('confirmação');
      await expect(generateText({ model: metered(model()), prompt: 'cannot continue', maxRetries: 0 })).rejects.toThrow('confirmação');
    });
    expect(h.reserve).toHaveBeenCalledTimes(1);
    expect(h.settle).toHaveBeenCalledWith(expect.anything(), expect.any(String), { status: 'unknown', metadata: { reason: 'missing_provider_usage' } });
  });

  it('timeout after dispatch remains unknown; no automatic retries or cancellation refunds', async () => {
    const provider = vi.fn(async () => { throw new Error('timeout'); });
    await expect(runWithUsageContext(context(), () => generateText({ model: metered(model(provider)), prompt: 'x', maxRetries: 0 }))).rejects.toThrow('timeout');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(h.settle.mock.calls[0][2].status).toBe('unknown');
  });

  it('reserves separately for every tool step, including the additional tool output', async () => {
    const provider = vi.fn().mockResolvedValueOnce({ ...reply(), content: [{ type: 'tool-call', toolCallId: 'one', toolName: 'helper', input: '{}' }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' } }).mockResolvedValueOnce(reply());
    await runWithUsageContext(context(), () => generateText({ model: metered(model(provider)), prompt: 'test', maxRetries: 0, stopWhen: stepCountIs(3), tools: { helper: tool({ inputSchema: z.object({}), execute: async () => 'a'.repeat(300) }) } }));
    expect(provider).toHaveBeenCalledTimes(2);
    expect(h.reserve).toHaveBeenCalledTimes(2);
    expect(h.reserve.mock.calls[1][1].reservedAmount).toBeGreaterThan(h.reserve.mock.calls[0][1].reservedAmount);
    expect(h.reserve.mock.calls[1][1].idempotencyKey).not.toBe(h.reserve.mock.calls[0][1].idempotencyKey);
  });

  it('keeps helper operations on the parent account and isolates concurrent organizations', async () => {
    await Promise.all(['org-a', 'org-b'].map(org => runWithUsageContext(context(org), async () => {
      await generateText({ model: metered(model(), 'helper'), prompt: 'fictitious', maxRetries: 0 });
      expect(getUsageContext()?.organizationId).toBe(org);
    })));
    expect(h.reserve.mock.calls.map(call => call[0].organizationId).sort()).toEqual(['org-a', 'org-b']);
    expect(h.reserve.mock.calls.every(call => call[0].accountId === 'account' && call[1].operation === 'helper')).toBe(true);
    expect(getUsageContext()).toBeUndefined();
  });

  it('meters embedding batches at the model boundary with no response tokens', async () => {
    const embed: EmbeddingModelV3 = { specificationVersion: 'v3', provider: 'openai', modelId: 'text-embedding-3-small', maxEmbeddingsPerCall: 1, supportsParallelCalls: false, doEmbed: vi.fn(async () => ({ embeddings: [[1, 2]], usage: { tokens: 10 }, warnings: [] })) };
    await runWithUsageContext(context(), () => embedMany({ model: meterEmbeddingModel(embed, { provider: 'openai', modelId: embed.modelId, operation: 'embedding' }), values: ['alpha', 'beta'], maxRetries: 0 }));
    expect(h.reserve).toHaveBeenCalledTimes(2);
    expect(h.settle.mock.calls.every(call => call[2].inputTokens === 10 && call[2].outputTokens === 0)).toBe(true);
  });

  it('reads Google embedding usage from the documented raw metadata dropped by this SDK', async () => {
    const embed: EmbeddingModelV3 = { specificationVersion: 'v3', provider: 'google', modelId: 'gemini-embedding-001', maxEmbeddingsPerCall: 64, supportsParallelCalls: false, doEmbed: vi.fn(async () => ({ embeddings: [[1, 2]], response: { body: { usageMetadata: { promptTokenCount: 17 }, embedding: { values: [1, 2] } } }, warnings: [] })) };
    await runWithUsageContext(context(), () => embedMany({ model: meterEmbeddingModel(embed, { provider: 'google', modelId: embed.modelId, operation: 'embedding' }), values: ['text'], maxRetries: 0 }));
    expect(h.settle.mock.calls[0][2]).toMatchObject({ status: 'completed', totalTokens: 17 });
  });

  it('keeps custom models available while only measuring, without falsely enforcing estimates', async () => {
    const provider = vi.fn(async () => ({ ...reply(), usage: { ...usage, inputTokens: { ...usage.inputTokens, total: 90000 } } }));
    await runWithUsageContext({ ...context(), policyEnabled: false }, () => generateText({ model: meterLanguageModel(model(provider), { provider: 'openai', modelId: 'gpt-5.1-custom', operation: 'reply' }), prompt: 'x', maxRetries: 0 }));
    expect(h.block).not.toHaveBeenCalled();
    expect(h.settle.mock.calls[0][2]).toMatchObject({ status: 'completed', actualAmount: 90010 });
  });

  it('blocks streaming, unknown models, huge text and unbounded output before payment', async () => {
    const provider = vi.fn(async () => reply());
    await expect(runWithUsageContext(context(), () => generateText({ model: metered(model(provider)), prompt: 'x', maxRetries: 0, maxOutputTokens: 999999 }))).rejects.toThrow();
    await expect(runWithUsageContext(context(), () => generateText({ model: meterLanguageModel(model(provider), { provider: 'openai', modelId: 'unknown', operation: 'reply' }), prompt: 'x', maxRetries: 0 }))).rejects.toThrow();
    expect(() => textInputBound('a'.repeat(1_000_001))).toThrow();
    expect(provider).not.toHaveBeenCalled();
  });

  it('retains a preflight failure even when a helper catches it before any reservation', async () => {
    const provider = vi.fn(async () => reply());
    await runWithUsageContext(context(), async () => {
      await expect(generateText({ model: metered(model(provider)), prompt: 'a'.repeat(1_000_001), maxRetries: 0 })).rejects.toThrow('limite seguro');
      expect(() => assertUsageHealthy()).toThrow('limite seguro');
      await expect(generateText({ model: metered(model(provider)), prompt: 'cannot continue', maxRetries: 0 })).rejects.toThrow('limite seguro');
    });
    expect(provider).not.toHaveBeenCalled();
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it('remains unhealthy if persisting an unsupported-operation block fails', async () => {
    const provider = vi.fn(async () => reply());
    h.block.mockRejectedValueOnce(new Error('database unavailable'));
    await runWithUsageContext(context(), async () => {
      await expect(generateText({ model: meterLanguageModel(model(provider), { provider: 'openai', modelId: 'unsupported', operation: 'helper' }), prompt: 'x', maxRetries: 0 })).rejects.toThrow('database');
      expect(() => assertUsageHealthy()).toThrow('reserva de consumo segura');
      await expect(generateText({ model: metered(model(provider)), prompt: 'cannot continue', maxRetries: 0 })).rejects.toThrow('reserva de consumo segura');
    });
    expect(provider).not.toHaveBeenCalled();
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it('marks measurement-only reservations so a newly enabled policy can reject dispatch', async () => {
    await runWithUsageContext({ ...context(), policyEnabled: false }, () => meteredOperation({ operation: 'test', provider: 'openai', model: 'unknown', bound: 100, metadata: { enforcementChecked: true }, execute: async () => 1, usage: value => value }));
    expect(h.reserve.mock.calls[0][1].metadata.enforcementChecked).toBe(false);
  });

  it('uses a separate seconds unit for transcription, preserving fractional actual duration', async () => {
    await runWithUsageContext(context(), () => meteredOperation({ operation: 'audio_transcription', provider: 'openai', model: 'whisper-1', unit: 'seconds', bound: 12, execute: async () => ({ duration: 10.5 }), usage: value => value.duration }));
    expect(h.reserve.mock.calls[0][1]).toMatchObject({ unit: 'seconds', reservedAmount: 12 });
    expect(h.settle.mock.calls[0][2]).toMatchObject({ actualAmount: 10.5 });
    expect(h.settle.mock.calls[0][2].estimatedCostUsd).toBeCloseTo(0.00105, 10);
    expect(h.settle.mock.calls[0][2].totalTokens).toBeUndefined();
  });
});

describe('usage normalization and versioned tariffs', () => {
  it('normalizes SDKv3 and rejects unknown/invalid usage instead of inventing zero', () => {
    expect(normalizeLanguageUsage(usage)?.totalTokens).toBe(30);
    expect(normalizeLanguageUsage({})).toBeNull();
    expect(normalizeLanguageUsage({ inputTokens: -1, outputTokens: 5 })).toBeNull();
    expect(normalizeEmbeddingUsage({ tokens: 7 })?.totalTokens).toBe(7);
  });
  it('does not invent costs or double-charge cached input', () => {
    const normalized = normalizeLanguageUsage(usage)!;
    expect(estimateTokenCost(normalized)).toEqual({ estimatedCostUsd: null, pricingVersion: null });
    const priced = estimateTokenCost(normalized, { version: 'fictitious-test-tariff', provider: 'fake', model: 'fake', currency: 'USD', inputPerMillion: 1, cachedInputPerMillion: 0.5, outputPerMillion: 2 });
    expect(priced.estimatedCostUsd).toBeCloseTo(0.000036);
  });
});
