import { wrapLanguageModel, wrapEmbeddingModel, type LanguageModel, type EmbeddingModel } from 'ai';
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { blockConversationBudget, dispatchUsage, reserveUsage, settleUsage } from './budget';
import { AiUsageError, failUsage, nextUsageOperationId, requireUsageContext } from './context';
import { normalizeEmbeddingUsage, normalizeLanguageUsage, type NormalizedUsage } from './normalize';
import { estimateOperationCost } from './pricing';
import type { UsageContext } from './types';
import { audioDurationBound } from './audioBound';

const MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_OUTPUT_TOKENS = 2000;
const MAX_TEXT_INPUT_BYTES = 1_000_000;
const KNOWN_MODELS: Record<string, RegExp> = {
  openai: /^(gpt-4(?:\.1|o)(?:-mini)?|gpt-5(?:\.2|-mini)?)(?:-\d{4}-\d{2}-\d{2})?$/,
  anthropic: /^claude-(?:sonnet|haiku|opus)-4-5(?:-\d{8})?$/,
  google: /^gemini-2\.5-(?:flash(?:-lite)?|pro)$/,
};

async function unsupported(context: UsageContext): Promise<never> {
  const failure = failUsage(new AiUsageError('AI_USAGE_UNSUPPORTED', 'Esta operação não possui uma reserva de consumo segura. O atendimento humano continua disponível.'));
  if (context.policyEnabled) await blockConversationBudget(context, 'unsupported_usage_bound');
  throw failure;
}
export function rejectUnsupportedUsage(): Promise<never> { return unsupported(requireUsageContext()); }

/** UTF-8 bytes upper-bound text tokens; generous JSON/framing overhead covers provider serialization. */
export function textInputBound(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    const bytes = Math.max(Buffer.byteLength(json, 'utf8'), Buffer.byteLength(json.normalize('NFKC'), 'utf8'));
    if (bytes > MAX_TEXT_INPUT_BYTES) throw new AiUsageError('AI_USAGE_INPUT_TOO_LARGE', 'O conteúdo desta operação excede o limite seguro da IA.');
    return bytes * 2 + 4096;
  } catch (error) { throw failUsage(error); }
}

async function imageBound(data: Uint8Array, provider: string): Promise<number> {
  const sharp = (await import('sharp')).default;
  const info = await sharp(data, { limitInputPixels: 40_000_000, animated: true }).metadata();
  if (!info.width || !info.height || (info.pages ?? 1) !== 1) throw new AiUsageError('AI_USAGE_UNSUPPORTED_IMAGE');
  // Upper bounds use original dimensions (providers may downscale them). Sources verified 2026-10-23:
  // developers.openai.com/api/docs/guides/images-vision (worst catalog multiplier: gpt-4o-mini)
  // ai.google.dev/gemini-api/docs/tokens; platform.claude.com/docs/en/build-with-claude/vision
  if (provider === 'openai') return 3000 + Math.ceil(info.width / 512) * Math.ceil(info.height / 512) * 6000;
  if (provider === 'google') return 1024 + Math.ceil(info.width / 384) * Math.ceil(info.height / 384) * 300;
  return 1024 + Math.ceil(info.width / 28) * Math.ceil(info.height / 28) * 2;
}

async function languageInputBound(params: LanguageModelV3CallOptions, provider: string, context: UsageContext): Promise<number> {
  if (!context.policyEnabled) {
    const serialized = JSON.stringify({ prompt: params.prompt, tools: params.tools, responseFormat: params.responseFormat }, (_key, value: unknown) => value instanceof Uint8Array ? { mediaBytes: value.byteLength } : value);
    return Buffer.byteLength(serialized, 'utf8') * 2 + 4096;
  }
  let mediaTokens = 0;
  const prompt: unknown[] = [];
  for (const message of params.prompt) {
    if (message.role === 'system') { prompt.push(message); continue; }
    const content: unknown[] = [];
    for (const part of message.content) {
      if (part.type !== 'file') { content.push(part); continue; }
      if (!(part.data instanceof Uint8Array)) return unsupported(context);
      if (part.mediaType.startsWith('audio/') && provider === 'google') {
        const seconds = audioDurationBound(part.data);
        if (!seconds || seconds > 600) return unsupported(context);
        mediaTokens += seconds * 32 + 1024;
      } else if (part.mediaType.startsWith('image/')) {
        try { mediaTokens += await imageBound(part.data, provider); } catch { return unsupported(context); }
      } else return unsupported(context);
      content.push({ type: 'text', text: '[mídia]' });
    }
    prompt.push({ ...message, content });
  }
  if (params.tools?.some(tool => tool.type === 'provider')) return unsupported(context);
  return textInputBound({ prompt, tools: params.tools, responseFormat: params.responseFormat }) + mediaTokens;
}

/** Every dispatch gets its own id, including SDK tool steps; unresolved requests never release quota. */
export async function meteredOperation<T>(input: {
  operation: string; provider: string; model: string; unit?: 'tokens' | 'seconds'; bound: number; agentId?: string;
  standardPricing?: boolean;
  metadata?: Record<string, unknown>; execute: () => PromiseLike<T>; usage: (result: T) => NormalizedUsage | number | null;
}): Promise<T> {
  const context = requireUsageContext();
  let attemptId: string | null = null;
  let dispatched = false;
  let settled = false;
  try {
    if (!Number.isSafeInteger(input.bound) || input.bound <= 0) return unsupported(context);
    const reservation = await reserveUsage(input.agentId ? { ...context, agentId: input.agentId } : context, {
      idempotencyKey: nextUsageOperationId(), operation: input.operation, provider: input.provider, model: input.model,
      unit: input.unit ?? 'tokens', reservedAmount: input.bound,
      metadata: { ...input.metadata, enforcementChecked: context.policyEnabled },
    });
    if (!reservation.allowed || reservation.replay || !reservation.attempt_id) throw new AiUsageError('AI_USAGE_LIMIT', reservation.reason ?? undefined);
    attemptId = reservation.attempt_id;
    if (!(await dispatchUsage(context, attemptId))) throw new AiUsageError('AI_USAGE_DISPATCH_DENIED');
    dispatched = true;
    const result = await input.execute();
    const usage = input.usage(result);
    const amount = typeof usage === 'number' ? usage : usage?.totalTokens;
    if (amount == null || !Number.isFinite(amount) || amount < 0) {
      await settleUsage(context, attemptId, { status: 'unknown', metadata: { reason: 'missing_provider_usage' } });
      settled = true;
      throw new AiUsageError('AI_USAGE_UNKNOWN', 'O consumo da última operação aguarda confirmação. A IA permanece pausada.');
    }
    await settleUsage(context, attemptId, {
      status: 'completed', actualAmount: amount,
      ...(typeof usage === 'object' && usage ? usage : {}),
      ...estimateOperationCost({ provider: input.provider, model: input.model, operation: input.operation, usage: usage!, standardPricing: input.standardPricing }),
      metadata: { boundExceeded: amount > input.bound, ...(typeof usage === 'object' && usage ? { cacheWriteTokens: usage.cacheWriteTokens ?? null } : {}) },
    });
    settled = true;
    if (amount > input.bound && context.policyEnabled) {
      await blockConversationBudget(context, 'usage_bound_exceeded');
      throw new AiUsageError('AI_USAGE_BOUND_EXCEEDED');
    }
    return result;
  } catch (error) {
    if (attemptId && !settled) {
      // Failure to persist also keeps the dispatched reservation outstanding.
      try { await settleUsage(context, attemptId, { status: dispatched ? 'unknown' : 'cancelled', metadata: { reason: dispatched ? 'provider_or_settlement_error' : 'dispatch_not_authorized' } }); } catch { /* fail closed */ }
    }
    throw failUsage(error);
  }
}

export function meterLanguageModel(model: LanguageModel, input: { provider: string; modelId: string; operation: string; agentId?: string }): LanguageModel {
  if (typeof model === 'string' || model.specificationVersion !== 'v3') throw failUsage(new AiUsageError('AI_USAGE_MODEL_UNSUPPORTED'));
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: 'v3',
    async transformParams({ params }) {
      const context = requireUsageContext();
      if (context.policyEnabled && !KNOWN_MODELS[input.provider]?.test(input.modelId)) return unsupported(context);
      const maxOutputTokens = params.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS;
      if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || (context.policyEnabled && maxOutputTokens > MAX_OUTPUT_TOKENS)) return unsupported(context);
      if (!context.policyEnabled) return { ...params, maxOutputTokens };
      // Disable unbounded thinking/provider-side tools. Gemini Pro needs a nonzero explicit thinking budget.
      const providerOptions: LanguageModelV3CallOptions['providerOptions'] = input.provider === 'anthropic'
        ? { anthropic: { thinking: { type: 'disabled' as const } } }
        : input.provider === 'google'
          ? { google: { thinkingConfig: { thinkingBudget: input.modelId.endsWith('-pro') ? 1024 : 0 } } }
          : undefined;
      return { ...params, providerOptions, maxOutputTokens };
    },
    async wrapGenerate({ doGenerate, params }) {
      try {
        const context = requireUsageContext();
        const inputBound = await languageInputBound(params, input.provider, context);
        const outputBound = (params.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS) + (input.provider === 'google' && input.modelId.endsWith('-pro') ? 1024 : 0);
        const hasAudio = params.prompt.some(message => message.role !== 'system' && message.content.some(part => part.type === 'file' && part.mediaType.startsWith('audio/')));
        const tier = params.providerOptions?.[input.provider]?.serviceTier;
        const standardPricing = !params.tools?.some(tool => tool.type === 'provider')
          && (tier == null || tier === 'default' || tier === 'standard')
          && !(input.provider === 'google' && hasAudio);
        return await meteredOperation({
          operation: input.operation, provider: input.provider, model: input.modelId, bound: inputBound + outputBound, agentId: input.agentId, standardPricing,
          metadata: { inputBound, outputBound, boundVersion: 'utf8-framing-v1' }, execute: doGenerate, usage: result => normalizeLanguageUsage(result.usage),
        });
      } catch (error) { throw failUsage(error); }
    },
    async wrapStream() { return unsupported(requireUsageContext()); },
  } });
}

export function meterEmbeddingModel(model: EmbeddingModel, input: { provider: string; modelId: string; operation: string }): EmbeddingModel {
  if (typeof model === 'string' || model.specificationVersion !== 'v3') throw failUsage(new AiUsageError('AI_USAGE_MODEL_UNSUPPORTED'));
  return wrapEmbeddingModel({ model, middleware: {
    specificationVersion: 'v3',
    async wrapEmbed({ doEmbed, params }) {
      try {
        return await meteredOperation({ operation: input.operation, provider: input.provider, model: input.modelId,
          bound: textInputBound(params.values), execute: doEmbed, usage: result => normalizeEmbeddingUsage(result.usage, input.provider === 'google' ? result.response?.body : undefined) });
      } catch (error) { throw failUsage(error); }
    },
  } });
}
