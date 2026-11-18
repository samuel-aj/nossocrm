import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), generateText: h.generate }));
import type { LanguageModel } from 'ai';
import { generateAgentReply } from './replyGeneration';
import { normalizeAgentRow } from './context';

const agent = normalizeAgentRow({ id: 'agent', organization_id: 'org', name: 'Triagem', provider: 'openai', model: 'gpt-4.1', tools: {}, outcomes: [], custom_actions: [] });
const input = { agent, model: {} as LanguageModel, system: 'Converse com o cliente.', messages: [{ role: 'user' as const, content: 'Posso continuar?' }] };
const withLookup = { ...agent, custom_actions: [{ key: 'preco', label: 'Preço', description: 'Pergunta por preço', actions: [
  { type: 'consult_knowledge' as const, knowledgeId: 'd1', description: 'Tabela de preços' },
  { type: 'stop' as const },
] }] };
const saved = { toolName: 'salvar_dados', toolCallId: 'save', input: { dados: { autorizacao: true } } };
const step = (text: string, calls: typeof saved[] = []) => ({ text, toolCalls: calls, toolResults: calls.map(c => ({ toolCallId: c.toolCallId, output: { ok: true } })) });
const result = (steps: ReturnType<typeof step>[]) => ({ steps, text: steps.at(-1)?.text, totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, finishReason: 'stop' });
beforeEach(() => h.generate.mockReset());

describe('preparação da resposta dos agentes', () => {
  it('permite uma última resposta com os trechos consultados, sem repetir a ação final', async () => {
    h.generate.mockImplementationOnce(async ({ stopWhen, prepareStep }) => {
      const steps = [{ toolCalls: [{ toolName: 'executar_acao', input: { acao: 'preco' } }] }];
      expect(stopWhen.some((stop: (args: { steps: unknown[] }) => boolean) => stop({ steps }))).toBe(false);
      expect(prepareStep({ steps })).toEqual({ toolChoice: 'none' });
      return result([step('O serviço custa 27 reais.')]);
    });
    expect((await generateAgentReply({ ...input, agent: withLookup })).text).toBe('O serviço custa 27 reais.');
  });
  it.each(['O serviço custa 27 reais.', ''])('descarta o preço escrito antes da consulta, inclusive no fallback de texto (%s)', async answer => {
    const lookup = { toolName: 'executar_acao', toolCallId: 'consulta', input: { acao: 'preco', detalhes: 'Valor do serviço?' } };
    const unconfirmed = 'O serviço custa 40 reais.';
    const before = { text: unconfirmed, toolCalls: [lookup], toolResults: [{ toolCallId: 'consulta', output: { ok: true } }] };
    h.generate.mockResolvedValueOnce({ steps: answer ? [before, step(answer)] : [before], text: answer || unconfirmed, totalUsage: {}, finishReason: 'stop' });
    const reply = await generateAgentReply({ ...input, agent: withLookup });
    expect(reply.text).toBe(answer);
    expect(reply.toolCalls).toHaveLength(1);
  });
  it('preserva o formato de uma fala literal do roteiro mesmo se o modelo a escrever sem acionar a ferramenta', async () => {
    const clip = 'Vou te enviar o link.';
    h.generate.mockResolvedValueOnce(result([step(clip + ' https://exemplo.invalid/assinar')]));
    const reply = await generateAgentReply({ ...input, agent: { ...agent, system_prompt: '[audio]' + clip + '[/audio]' } });
    expect(reply.segments).toEqual([
      { kind: 'text', text: clip, voice: true, step: 0 },
      { kind: 'text', text: 'https://exemplo.invalid/assinar', step: 0 },
    ]);
  });
  it('envia uma única cópia da pergunta repetida antes e depois de salvar dados', async () => {
    const text = 'Preciso fazer algumas perguntas rápidas.\nPosso continuar?';
    h.generate.mockResolvedValueOnce(result([step(text, [saved]), step(text)]));
    const reply = await generateAgentReply(input);
    expect(reply.text).toBe(text);
    expect(reply.toolCalls).toHaveLength(1);
  });
  it('preserva texto anterior à ferramenta quando o último passo não tem texto', async () => {
    h.generate.mockResolvedValueOnce(result([step('Qual o valor?', [saved]), step('')]));
    expect((await generateAgentReply(input)).text).toBe('Qual o valor?');
  });
  it('reescreve JSON interno uma vez, sem ferramentas nem repetição da ação original', async () => {
    h.generate.mockResolvedValueOnce(result([step('{"dados":{"autorizacao":true}}', [saved])]));
    h.generate.mockResolvedValueOnce({ output: { replacements: [{ id: 0, text: 'Qual o valor aproximado?' }] }, totalUsage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } });
    const reply = await generateAgentReply(input);
    expect(reply.text).toBe('Qual o valor aproximado?');
    expect(reply.toolCalls).toHaveLength(1);
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(h.generate.mock.calls[1][0].tools).toBeUndefined();
    expect(h.generate.mock.calls[1][0].maxRetries).toBe(0);
    expect(reply.usage).toMatchObject({ totalTokens: 25 });
  });
  it('não devolve nada enviável quando a recuperação continua com dados internos', async () => {
    h.generate.mockResolvedValueOnce(result([step('Olá!\n{"dados":{"autorizacao":true}}')]));
    h.generate.mockResolvedValueOnce({ output: { replacements: [{ id: 0, text: '{"dados":{"autorizacao":true}}' }] } });
    const reply = await generateAgentReply(input);
    expect(reply.segments).toEqual([]);
    expect(reply.text).toBe('');
    expect(reply.outputSafety).toMatchObject({
      status: 'blocked', recoveryFailureCode: 'internal_content',
      blockedSamples: [
        { phase: 'original', segment: 0, step: 0, field: 'text', reason: 'internal_data', excerpt: 'Olá!\n{"dados":{"autorizacao":true}}' },
        { phase: 'review', segment: 0, step: 0, field: 'text', reason: 'internal_data', excerpt: '{"dados":{"autorizacao":true}}' },
      ],
    });
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it('limita o diagnóstico a três trechos de 500 caracteres e inclui a revisão rejeitada', async () => {
    const original = Array.from({ length: 4 }, (_, index) => `[interno-${index}]` + 'a'.repeat(600));
    const review = '[revisão interna]' + 'b'.repeat(600);
    h.generate.mockResolvedValueOnce(result(original.map(value => step(value))));
    h.generate.mockResolvedValueOnce({ output: { replacements: original.map((_, id) => ({ id, text: id === 0 ? review : 'Trecho corrigido.' })) } });
    const reply = await generateAgentReply(input);
    expect(reply.outputSafety.issues).toHaveLength(4);
    expect(reply.outputSafety.blockedSamples).toEqual([
      { phase: 'original', segment: 0, step: 0, field: 'text', reason: 'internal_marker', excerpt: original[0].slice(0, 500) },
      { phase: 'original', segment: 1, step: 1, field: 'text', reason: 'internal_marker', excerpt: original[1].slice(0, 500) },
      { phase: 'review', segment: 0, step: 0, field: 'text', reason: 'internal_marker', excerpt: review.slice(0, 500) },
    ]);
    expect(reply.text).toBe('');
    expect(reply.segments).toEqual([]);
  });
  it('não copia a fala literal do roteiro salvo para o diagnóstico', async () => {
    const clip = 'FALA_LITERAL_DO_ROTEIRO';
    h.generate.mockResolvedValueOnce({ steps: [{ text: '{"dados":{}}', toolCalls: [{ toolName: 'falar_trecho', toolCallId: 'voice', input: { trecho: 1 } }],
      toolResults: [{ toolCallId: 'voice', output: { ok: true } }] }], totalUsage: {}, finishReason: 'stop' });
    h.generate.mockRejectedValueOnce(new Error('revisão indisponível'));
    const reply = await generateAgentReply({ ...input, agent: { ...agent, system_prompt: '[audio]' + clip + '[/audio]' } });
    expect(reply.outputSafety.status).toBe('blocked');
    expect(reply.outputSafety.blockedSamples).toEqual([{ phase: 'original', segment: 0, step: 0, field: 'text', reason: 'internal_data', excerpt: '{"dados":{}}' }]);
    expect(JSON.stringify(reply.outputSafety)).not.toContain('FALA_LITERAL_DO_ROTEIRO');
    expect(reply.text).toBe('');
    expect(reply.segments).toEqual([]);
  });
  it('preserva encerramento sem inventar texto quando só há ferramenta', async () => {
    h.generate.mockResolvedValueOnce(result([step('', [{ ...saved, toolName: 'encerrar_atendimento' }])]));
    expect((await generateAgentReply(input)).text).toBe('');
    expect(h.generate).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ replacements: [] }, 'parse_or_provider_failure'],
    [{ replacements: [{ id: 1, text: 'Mensagem.' }] }, 'invalid_slots'],
    [{ replacements: [{ id: 0, text: '' }] }, 'invalid_slots'],
    [{ replacements: [{ id: 0, text: '[SEM_RESPOSTA]' }] }, 'invalid_slots'],
    [{ replacements: [{ id: 0, text: 'Mensagem.' }, { id: 0, text: 'Outra.' }] }, 'invalid_slots'],
  ])('bloqueia recuperação com trechos inválidos: %j', async (output, recoveryFailureCode) => {
    h.generate.mockResolvedValueOnce(result([step('{"dados":{}}')]));
    h.generate.mockResolvedValueOnce({ output });
    const reply = await generateAgentReply(input);
    expect(reply.outputSafety).toMatchObject({ status: 'blocked', recoveryFailureCode });
    expect(reply.text).toBe('');
    expect(reply.segments).toEqual([]);
  });
  it('bloqueia em falha do provedor sem uma terceira tentativa', async () => {
    h.generate.mockResolvedValueOnce(result([step('{"dados":{}}')]));
    h.generate.mockRejectedValueOnce(Object.assign(new Error('FALHA_PRIVADA_DO_PROVEDOR'), {
      headers: { authorization: 'TOKEN_PRIVADO' }, data: { prompt: 'PAYLOAD_PRIVADO' },
    }));
    const reply = await generateAgentReply({ ...input, system: 'SYSTEM_PRIVADO' });
    expect(reply.outputSafety).toMatchObject({ status: 'blocked', recoveryAttempted: true, recoveryFailureCode: 'parse_or_provider_failure' });
    for (const secret of ['FALHA_PRIVADA_DO_PROVEDOR', 'TOKEN_PRIVADO', 'PAYLOAD_PRIVADO', 'SYSTEM_PRIVADO']) {
      expect(JSON.stringify(reply.outputSafety)).not.toContain(secret);
    }
    expect(reply.text).toBe('');
    expect(reply.segments).toEqual([]);
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it('corrige a legenda mantendo a ordem e os trechos válidos em volta da mídia', async () => {
    const media = { toolName: 'enviar_midia', toolCallId: 'media', input: { nome: 'Guia', legenda: '{"dados":{}}' } };
    const mediaStep = { text: 'Segue o guia.', toolCalls: [media], toolResults: [{ toolCallId: 'media', output: { ok: true, midia: 'Guia' } }] };
    h.generate.mockResolvedValueOnce({ steps: [mediaStep, step('Conseguiu abrir?')], totalUsage: {}, finishReason: 'stop' });
    h.generate.mockResolvedValueOnce({ output: { replacements: [{ id: 1, text: 'Guia de atendimento.' }] } });
    const reply = await generateAgentReply(input);
    expect(reply.outputSafety).toMatchObject({ status: 'repaired', issues: [{ segment: 1, step: 0, field: 'caption', reason: 'internal_data' }] });
    expect(reply.outputSafety.blockedSamples).toEqual([{ phase: 'original', segment: 1, step: 0, field: 'caption', reason: 'internal_data', excerpt: '{"dados":{}}' }]);
    expect(reply.outputSafety.recoveryFailureCode).toBeUndefined();
    expect(reply.segments.map(s => s.kind === 'text' ? s.text : s.caption)).toEqual(['Segue o guia.', 'Guia de atendimento.', 'Conseguiu abrir?']);
    expect(reply.toolCalls).toHaveLength(1);
  });
  it('reescreve vários trechos em uma única chamada e recusa qualquer trecho ainda inválido', async () => {
    h.generate.mockResolvedValueOnce(result([step('{"dados":{}}'), step('Pode continuar.'), step('salvar_dados({})')]));
    h.generate.mockResolvedValueOnce({ output: { replacements: [{ id: 0, text: 'Obrigado.' }, { id: 2, text: 'Qual o valor?' }] } });
    const reply = await generateAgentReply(input);
    expect(reply.text).toBe('Obrigado.\nPode continuar.\nQual o valor?');
    expect(reply.outputSafety.status).toBe('repaired');
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
});
