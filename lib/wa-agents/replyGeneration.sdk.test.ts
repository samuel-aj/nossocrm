/** Exercise the installed AI SDK and real tools; only the model transport is fake. */
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider';
vi.mock('server-only', () => ({}));
import { normalizeAgentRow } from './context';
import { generateAgentReply } from './replyGeneration';

const agent = normalizeAgentRow({
  id: 'agent', organization_id: 'org', name: 'Triagem', provider: 'openai', model: 'gpt-4.1',
});
const input = { agent, system: 'Converse com o cliente.', messages: [{ role: 'user' as const, content: 'Sim' }] };
function response(content: LanguageModelV3GenerateResult['content']): LanguageModelV3GenerateResult {
  return {
    content,
    finishReason: { unified: content.some(c => c.type === 'tool-call') ? 'tool-calls' : 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
    warnings: [],
  };
}
const text = (value: string) => response([{ type: 'text', text: value }]);
const save = { type: 'tool-call' as const, toolCallId: 'save', toolName: 'salvar_dados', input: '{"dados":{"autorizacao":true}}' };
function queuedModel(responses: LanguageModelV3GenerateResult[]) {
  // AI SDK 6.0.3's array shortcut indexes from 1; use an explicit queue.
  return new MockLanguageModelV3({ doGenerate: async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected extra model call');
    return next;
  } });
}

describe('contrato com o AI SDK instalado', () => {
  it('remove repetição entre passos reais sem perder o resultado da ferramenta', async () => {
    const question = 'Preciso fazer algumas perguntas rápidas.\nPosso continuar?';
    const model = queuedModel([response([{ type: 'text', text: question }, save]), text(question)]);
    const result = await generateAgentReply({ ...input, model });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(result.text).toBe(question);
    expect(result.toolCalls).toEqual([{ tool: 'salvar_dados', input: { dados: { autorizacao: true } }, output: { ok: true } }]);
    expect(result.outputSafety).toMatchObject({ status: 'passed', duplicatesRemoved: 2 });
  });

  it('faz a recuperação estruturada sem ferramentas após uma geração com ferramenta', async () => {
    const model = queuedModel([
      response([save]),
      text('{"dados":{"autorizacao":true}}'),
      text('{"replacements":[{"id":0,"text":"Qual o valor aproximado?"}]}'),
    ]);
    const result = await generateAgentReply({ ...input, model });
    expect(result.text).toBe('Qual o valor aproximado?');
    expect(result.outputSafety.status).toBe('repaired');
    expect(result.toolCalls).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(3);
    const repair = model.doGenerateCalls[2];
    expect(repair.tools ?? []).toHaveLength(0);
    expect(repair.responseFormat).toMatchObject({ type: 'json', schema: expect.any(Object) });
    expect(repair.prompt.some(m => m.role === 'tool')).toBe(false);
    expect(result.usage).toMatchObject({ inputTokens: 30, outputTokens: 15, totalTokens: 45 });
  });

  it('bloqueia erro real de parsing do SDK sem terceira chamada ao provedor', async () => {
    const model = queuedModel([text('{"dados":{}}'), text('JSON inválido')]);
    const result = await generateAgentReply({ ...input, model });
    expect(result.outputSafety.status).toBe('blocked');
    expect(result.text).toBe('');
    expect(result.segments).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(2);
  });
});
