// @vitest-environment node
// Real installed SDK and middleware; transport and quota storage are offline fixtures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText, Output, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { getModel } from './config';
import { OPENAI_REASONING_MODEL_IDS, supportsModelTemperature } from './modelCapabilities';
import { meterLanguageModel } from '@/lib/ai-usage/meteredModel';
import { runWithUsageContext } from '@/lib/ai-usage/context';
import type { UsageContext } from '@/lib/ai-usage/types';

const h = vi.hoisted(() => ({ reserve: vi.fn(), dispatch: vi.fn(), settle: vi.fn(), block: vi.fn(), budget: vi.fn() }));
vi.mock('@/lib/ai-usage/budget', () => ({
  reserveUsage: h.reserve, dispatchUsage: h.dispatch, settleUsage: h.settle,
  blockConversationBudget: h.block, checkConversationBudget: h.budget,
}));

function context(policyEnabled: boolean): UsageContext {
  return { admin: {} as never, organizationId: 'offline-org', conversationId: 'offline-conversation',
    accountId: 'offline-account', agentId: 'offline-agent', runId: null, dealId: null,
    scope: 'test', policyEnabled };
}
function metered(id: string, operation = 'reply') {
  return meterLanguageModel(getModel('openai', 'offline-fixture-key', id), { provider: 'openai', modelId: id, operation });
}
function textOutput(text: string): Array<Record<string, unknown>> {
  return [{ type: 'message', id: 'msg_offline', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }] }];
}
function transport(outputs: Array<Array<Record<string, unknown>>>) {
  const requests: Array<Record<string, unknown>> = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    expect(init?.method).toBe('POST');
    const output = outputs.shift();
    if (!output) throw new Error('Unexpected offline provider call');
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: `resp_offline_${requests.length}`, object: 'response',
      created_at: 1_700_000_000, status: 'completed', model: requests.at(-1)?.model, output,
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 10 },
        output_tokens: 15, output_tokens_details: { reasoning_tokens: 5 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, requests };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.reserve.mockImplementation(async (_context, input) => ({ allowed: true, replay: false,
    attempt_id: input.idempotencyKey, status: 'reserved' }));
  h.dispatch.mockResolvedValue(true);
  h.settle.mockResolvedValue(undefined);
  h.block.mockResolvedValue(undefined);
  h.budget.mockResolvedValue({ blocked_at: null, tokens_used: 0, tokens_reserved: 0, tokens_granted: 0,
    policy: { enabled: true, conversation_tokens: 300_000 } });
});
afterEach(() => vi.unstubAllGlobals());

describe('new OpenAI reasoning models through the installed Responses SDK', () => {
  const cases = OPENAI_REASONING_MODEL_IDS.flatMap(id => [true, false].map(policy => ({ id, policy })));
  it.each(cases)('$id tool roundtrip with consumption policy $policy', async ({ id, policy }) => {
    const http = transport([
      [{ type: 'reasoning', id: 'rs_offline', summary: [] },
        { type: 'function_call', id: 'fc_offline', call_id: 'call_offline', name: 'lookup',
          arguments: '{"record":"fixture"}', status: 'completed' }],
      textOutput('Dados conferidos na simulação.'),
    ]);
    const lookup = vi.fn(async () => ({ found: true }));
    const result = await runWithUsageContext(context(policy), () => generateText({
      model: metered(id), system: 'Instrução fictícia.', prompt: 'Consultar fixture.',
      maxOutputTokens: 2000, maxRetries: 0, temperature: 0.5, topP: 0.9,
      stopWhen: stepCountIs(3),
      tools: { lookup: tool({ inputSchema: z.object({ record: z.string() }), execute: lookup }) },
    }));
    expect(result.text).toBe('Dados conferidos na simulação.');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(http.requests).toHaveLength(2);
    for (const body of http.requests) {
      expect(body).toMatchObject({ model: id, max_output_tokens: 2000 });
      expect(body.input).toEqual(expect.arrayContaining([{ role: 'developer', content: 'Instrução fictícia.' }]));
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('top_p');
      expect(body).not.toHaveProperty('reasoning'); // Keep the provider default; no forced effort.
    }
    expect(http.requests[1].input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call_output', call_id: 'call_offline', output: '{"found":true}' }),
    ]));
    expect(h.reserve).toHaveBeenCalledTimes(2);
    expect(h.settle).toHaveBeenCalledTimes(2);
    for (const [, , settlement] of h.settle.mock.calls) {
      expect(settlement).toMatchObject({ status: 'completed', totalTokens: 115, actualAmount: 115,
        inputTokens: 100, outputTokens: 15, cachedInputTokens: 10, reasoningTokens: 5 });
    }
    expect(h.reserve.mock.calls[0][1].metadata.enforcementChecked).toBe(policy);
    expect(http.fetch.mock.invocationCallOrder[0]).toBeGreaterThan(h.dispatch.mock.invocationCallOrder[0]);
    expect(h.block).not.toHaveBeenCalled();
  });

  it.each(OPENAI_REASONING_MODEL_IDS)('%s still stops before provider dispatch when quota is denied', async id => {
    const http = transport([]);
    h.reserve.mockResolvedValueOnce({ allowed: false, replay: false, attempt_id: null, reason: 'conversation_token_limit' });
    await expect(runWithUsageContext(context(true), () => generateText({
      model: metered(id), prompt: 'Sem saldo.', maxRetries: 0,
    }))).rejects.toMatchObject({ code: 'AI_USAGE_LIMIT' });
    expect(http.fetch).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it.each(['gpt-6-luna-custom', 'gpt-6.2-terra', 'gpt-6-unknown'])('does not allow an unverified alias %s with enforcement', async id => {
    const http = transport([]);
    await expect(runWithUsageContext(context(true), () => generateText({
      model: metered(id), prompt: 'Alias fictício.', maxRetries: 0,
    }))).rejects.toMatchObject({ code: 'AI_USAGE_UNSUPPORTED' });
    expect(http.fetch).not.toHaveBeenCalled();
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.block).toHaveBeenCalledWith(expect.anything(), 'unsupported_usage_bound');
  });

  it('preserves permitted provider options and enforces reasoning even without a usage policy', async () => {
    const http = transport([textOutput('Simulação.')]);
    await runWithUsageContext(context(false), () => generateText({
      model: metered('gpt-6-astra'), system: 'Instrução.', prompt: 'Teste.', maxRetries: 0,
      providerOptions: { openai: { forceReasoning: false, reasoningEffort: 'low', store: false } },
    }));
    expect(http.requests[0]).toMatchObject({ store: false, reasoning: { effort: 'low' } });
    expect(http.requests[0].include).toContain('reasoning.encrypted_content');
  });

  it.each(OPENAI_REASONING_MODEL_IDS)('%s retains structured output for reply review', async id => {
    const http = transport([textOutput('{"replacements":[{"id":0,"text":"Resposta segura."}]}')]);
    const result = await runWithUsageContext(context(true), () => generateText({
      model: metered(id), prompt: 'Revisão fictícia.', maxRetries: 0,
      output: Output.object({ schema: z.object({ replacements: z.array(z.object({ id: z.number(), text: z.string() })) }) }),
    }));
    expect(result.output).toEqual({ replacements: [{ id: 0, text: 'Resposta segura.' }] });
    expect(http.requests[0].text).toMatchObject({ format: { type: 'json_schema', strict: true } });
  });

  it.each(OPENAI_REASONING_MODEL_IDS)('%s meters binary image inputs with the existing conservative bound', async id => {
    const http = transport([textOutput('Uma imagem de teste.')]);
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    await runWithUsageContext(context(true), () => generateText({
      model: metered(id, 'image_understanding'), maxRetries: 0,
      messages: [{ role: 'user', content: [{ type: 'image', image, mediaType: 'image/png' }] }],
    }));
    expect(http.fetch).toHaveBeenCalledTimes(1);
    expect(h.reserve.mock.calls[0][1]).toMatchObject({ operation: 'image_understanding',
      metadata: { outputBound: 2000 } });
    expect(h.reserve.mock.calls[0][1].reservedAmount).toBeGreaterThan(11_000);
  });

  it('preserves GPT-4.1 temperature and the previous reasoning-temperature rules', async () => {
    const http = transport([textOutput('Modelo anterior.')]);
    await runWithUsageContext(context(true), () => generateText({
      model: metered('gpt-4.1'), prompt: 'Teste.', temperature: 0.5, maxRetries: 0,
    }));
    expect(http.requests[0].temperature).toBe(0.5);
    expect(supportsModelTemperature('openai', 'gpt-4.1')).toBe(true);
    expect(supportsModelTemperature('openai', 'gpt-5.6-luna')).toBe(false);
    expect(supportsModelTemperature('openai', 'o3')).toBe(false);
    expect(supportsModelTemperature('anthropic', 'claude-sonnet-4-5')).toBe(true);
    for (const id of OPENAI_REASONING_MODEL_IDS) expect(supportsModelTemperature('openai', id)).toBe(false);
  });
});
