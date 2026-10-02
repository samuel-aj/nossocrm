import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), generateText: h.generate }));
import type { LanguageModel } from 'ai';
import { generateAgentReply } from './engine';
import { normalizeAgentRow } from './context';

const agent = normalizeAgentRow({ id: 'agent', organization_id: 'org', name: 'Triagem', provider: 'openai', model: 'gpt-4.1', tools: {}, outcomes: [], custom_actions: [] });
const input = { agent, model: {} as LanguageModel, system: 'Converse com o cliente.', messages: [{ role: 'user' as const, content: 'Posso continuar?' }] };
const saved = { toolName: 'salvar_dados', toolCallId: 'save', input: { dados: { autorizacao: true } } };
const step = (text: string, calls: typeof saved[] = []) => ({ text, toolCalls: calls, toolResults: calls.map(c => ({ toolCallId: c.toolCallId, output: { ok: true } })) });
const result = (steps: ReturnType<typeof step>[]) => ({ steps, text: steps.at(-1)?.text, totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, finishReason: 'stop' });
beforeEach(() => h.generate.mockReset());

describe('preparação da resposta dos agentes', () => {
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
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it('preserva encerramento sem inventar texto quando só há ferramenta', async () => {
    h.generate.mockResolvedValueOnce(result([step('', [{ ...saved, toolName: 'encerrar_atendimento' }])]));
    expect((await generateAgentReply(input)).text).toBe('');
    expect(h.generate).toHaveBeenCalledTimes(1);
  });
  it.each([
    { replacements: [] },
    { replacements: [{ id: 1, text: 'Mensagem.' }] },
    { replacements: [{ id: 0, text: '' }] },
    { replacements: [{ id: 0, text: '[SEM_RESPOSTA]' }] },
    { replacements: [{ id: 0, text: 'Mensagem.' }, { id: 0, text: 'Outra.' }] },
  ])('bloqueia recuperação com trechos inválidos: %j', async output => {
    h.generate.mockResolvedValueOnce(result([step('{"dados":{}}')]));
    h.generate.mockResolvedValueOnce({ output });
    const reply = await generateAgentReply(input);
    expect(reply.outputSafety.status).toBe('blocked');
    expect(reply.text).toBe('');
    expect(reply.segments).toEqual([]);
  });
  it('bloqueia em falha do provedor sem uma terceira tentativa', async () => {
    h.generate.mockResolvedValueOnce(result([step('{"dados":{}}')]));
    h.generate.mockRejectedValueOnce(new Error('timeout'));
    const reply = await generateAgentReply(input);
    expect(reply.outputSafety).toMatchObject({ status: 'blocked', recoveryAttempted: true });
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it('corrige a legenda mantendo a ordem e os trechos válidos em volta da mídia', async () => {
    const media = { toolName: 'enviar_midia', toolCallId: 'media', input: { nome: 'Guia', legenda: '{"dados":{}}' } };
    const mediaStep = { text: 'Segue o guia.', toolCalls: [media], toolResults: [{ toolCallId: 'media', output: { ok: true, midia: 'Guia' } }] };
    h.generate.mockResolvedValueOnce({ steps: [mediaStep, step('Conseguiu abrir?')], totalUsage: {}, finishReason: 'stop' });
    h.generate.mockResolvedValueOnce({ output: { replacements: [{ id: 1, text: 'Guia de atendimento.' }] } });
    const reply = await generateAgentReply(input);
    expect(reply.outputSafety).toMatchObject({ status: 'repaired', issues: [{ segment: 1, step: 0, field: 'caption', reason: 'internal_data' }] });
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
