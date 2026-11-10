/** Exercise the installed AI SDK and real tools; only the model transport is fake. */
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider';
vi.mock('server-only', () => ({}));
import { normalizeAgentRow } from './context';
import { generateAgentReply } from './replyGeneration';
import type { AgentMediaRow } from './types';

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
  it.each([['[audio]', 'audio'], ['[vídeo]', 'video']] as const)('recupera %s com a ferramenta e preserva a ordem', async (marker, kind) => {
    const model = queuedModel([text('Olá! ' + marker + ' Conseguiu abrir?'),
      response([{ type: 'tool-call', toolCallId: 'recover', toolName: 'enviar_midia', input: '{"nome":"Tutorial"}' }])]);
    const sendMedia = vi.fn().mockResolvedValue({ ok: true });
    const result = await generateAgentReply({ ...input, model, runtime: { media: [{ name: 'Tutorial', kind } as AgentMediaRow], sendMedia } });
    expect(result.segments).toEqual([{ kind:'text', text:'Olá!', step:0 }, { kind:'media', name:'Tutorial', step:0, caption:undefined }, { kind:'text', text:'Conseguiu abrir?', step:0 }]);
    expect(model.doGenerateCalls[1].tools?.map(t=>t.name)).toEqual(['enviar_midia']);
    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(result.usage).toMatchObject({ totalTokens: 30 });
  });

  it('remove o marcador redundante sem enviar a mídia duas vezes', async () => {
    const model = queuedModel([response([{ type:'text', text:'Segue [áudio]' },
      { type: 'tool-call', toolCallId:'first', toolName:'enviar_midia', input:'{"nome":"Explicação"}' }]), text('')]);
    const sendMedia = vi.fn().mockResolvedValue({ok:true});
    const result = await generateAgentReply({ ...input, model, runtime: {media:[{name:'Explicação',kind:'audio'} as AgentMediaRow], sendMedia} });
    expect(result.segments.map(s=>s.kind)).toEqual(['text','media']);
    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it('só aceita a fala marcada que pertence ao roteiro salvo do follow-up', async () => {
    const followupInstruction = 'Fale [audio]Tudo bem com você?[/audio]';
    const good = await generateAgentReply({ ...input, followupInstruction, model:queuedModel([text('[audio]Tudo bem com você?[/audio]')]) });
    expect(good.segments).toEqual([{kind:'text', voice:true, text:'Tudo bem com você?', step:0}]);
    const bad = await generateAgentReply({ ...input, followupInstruction, model:queuedModel([text('[audio]Texto inventado[/audio]')]) });
    expect(bad.outputSafety.status).toBe('blocked');
    expect(bad.segments).toEqual([]);
  });

  it('bloqueia a entrega se na revisão o modelo só afirmar que enviou o vídeo', async () => {
    const model = queuedModel([text('[vídeo]'), text('Enviei o vídeo.')]);
    const sendMedia = vi.fn();
    const result = await generateAgentReply({ ...input, model, runtime: {media:[{name:'Tutorial',kind:'video'} as AgentMediaRow], sendMedia} });
    expect(result.outputSafety.status).toBe('blocked');
    expect(result.segments).toEqual([]);
    expect(sendMedia).not.toHaveBeenCalled();
  });
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
