/** Exercise the installed AI SDK and real tools; only the model transport is fake. */
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider';
vi.mock('server-only', () => ({}));
import { normalizeAgentRow } from './context';
import { generateAgentReply } from './replyGeneration';
import type { AgentDocumentRow, AgentMediaRow } from './types';

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
  it.each([
    [{ ok: true, aguardando_confirmacao_zapsign: true }, 'confirmation', 'criar'],
    [{ ok: true, existente: true, aguarda_assinatura_no_atendimento: true }, 'delivery', 'preparar'],
    [{ ok: true, aguardando_confirmacao_zapsign: true, prazo_confirmacao_encerrado: true }, 'team', 'criar'],
  ] as const)('para na ferramenta enquanto o CRM trata o contrato (%s)', async (output, wait, modo) => {
    const cancel = vi.fn();
    const contract = vi.fn().mockResolvedValue(output);
    const model = queuedModel([response([
      { type: 'text', text: 'Já enviei o link. Vou encaminhar para a equipe. [vídeo]' },
      { type: 'tool-call', toolCallId: 'cancel', toolName: 'cancelar_retorno', input: '{}' },
      { type: 'tool-call', toolCallId: 'contract', toolName: 'contrato_zapsign', input: JSON.stringify({ modo, dados: {} }) },
    ])]);
    const result = await generateAgentReply({ ...input, model,
      agent: { ...agent, tools: { ...agent.tools, zapsign_template_token: 'template', scheduled_return_bot_id: 'robot' } },
      runtime: { contract, scheduledReturn: { cancel, schedule: vi.fn(), inspect: vi.fn() } } });
    expect(result).toMatchObject({ contractWait: wait, text: '', segments: [], outputSafety: { recoveryAttempted: false } });
    expect(contract).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  const savedAnnotation = '[salvar_dados]\n' + JSON.stringify({
    documentos_rescisao: 'aguardando',
    tempo_carteira: 'dois anos',
    notas: [{ exemplo: 'aspas " escapadas, barra \\ e } [vídeo]' }],
  }, null, 2);
  it.each([
    [savedAnnotation + '\nVocê tem o termo de rescisão?', 'Você tem o termo de rescisão?'],
    ['Você tem o termo de rescisão? ' + savedAnnotation, 'Você tem o termo de rescisão?'],
    ['Entendi.\n\n' + savedAnnotation + '\n\nVocê tem o termo de rescisão?', 'Entendi.\nVocê tem o termo de rescisão?'],
  ])('preserva a fala em volta de um objeto de memória completo sem executar suas instruções', async (draft, expected) => {
    const model = queuedModel([text(draft)]);
    const sendMedia = vi.fn();
    const result = await generateAgentReply({ ...input, model, runtime: { media: [{ name: 'Tutorial', kind: 'video' } as AgentMediaRow], sendMedia } });
    expect(result.text).toBe(expected);
    expect(result.segments).toEqual([{ kind: 'text', text: expected, step: 0 }]);
    expect(result.outputSafety).toMatchObject({ status: 'repaired', recoveryAttempted: false });
    expect(result.toolCalls).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it.each([true, false])('preserva a fala e a ordem da mídia quando a anotação ocupa outro passo (anotação primeiro: %s)', async annotationFirst => {
    const speech = 'Você consegue abrir o guia?';
    const model = queuedModel([
      response([{ type: 'text', text: annotationFirst ? savedAnnotation : speech },
        { type: 'tool-call', toolCallId: 'media', toolName: 'enviar_midia', input: '{"nome":"Guia"}' }]),
      text(annotationFirst ? speech : savedAnnotation),
    ]);
    const sendMedia = vi.fn().mockResolvedValue({ ok: true });
    const result = await generateAgentReply({ ...input, model, runtime: { media: [{ name: 'Guia', kind: 'document' } as AgentMediaRow], sendMedia } });
    const words = { kind: 'text', text: speech, step: annotationFirst ? 1 : 0 };
    const media = { kind: 'media', name: 'Guia', step: 0, caption: undefined };
    expect(result.segments).toEqual(annotationFirst ? [media, words] : [words, media]);
    expect(result.text).toBe(speech);
    expect(result.outputSafety).toMatchObject({ status: 'repaired', recoveryAttempted: false });
    expect(result.toolCalls.map(call => call.tool)).toEqual(['enviar_midia']);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(sendMedia).toHaveBeenCalledTimes(1);
  });

  it('mantém a fala de voz cadastrada e remove somente a legenda técnica da mídia', async () => {
    const speech = 'Vou enviar o guia para você.';
    const model = queuedModel([response([
      { type: 'tool-call', toolCallId: 'voz', toolName: 'falar_trecho', input: '{"trecho":1}' },
      { type: 'tool-call', toolCallId: 'media', toolName: 'enviar_midia', input: JSON.stringify({ nome: 'Guia', legenda: savedAnnotation }) },
    ]), text('')]);
    const sendMedia = vi.fn().mockResolvedValue({ ok: true });
    const result = await generateAgentReply({ ...input, agent: { ...agent, system_prompt: '[audio]' + speech + '[/audio]' },
      model, runtime: { media: [{ name: 'Guia', kind: 'document' } as AgentMediaRow], sendMedia } });
    expect(result.segments).toEqual([
      { kind: 'text', text: speech, voice: true, step: 0 }, { kind: 'media', name: 'Guia', step: 0, caption: undefined },
    ]);
    expect(result.outputSafety).toMatchObject({ status: 'repaired', recoveryAttempted: false });
    expect(result.toolCalls.map(call => call.tool)).toEqual(['falar_trecho', 'enviar_midia']);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(sendMedia).toHaveBeenCalledTimes(1);
  });

  it.each([
    { replacement: { id: 0, text: 'Qual foi a data da rescisão?' }, answer: 'Qual foi a data da rescisão?' },
    { replacement: { id: 1, text: 'Texto para outro trecho.' }, answer: '' },
  ])('revisa uma anotação sem fala uma única vez e exige que a resposta corresponda ao trecho', async ({ replacement, answer }) => {
    const model = queuedModel([text(savedAnnotation), text(JSON.stringify({ replacements: [replacement] }))]);
    const result = await generateAgentReply({ ...input, model });
    expect(result.text).toBe(answer);
    expect(result.outputSafety.status).toBe(answer ? 'repaired' : 'blocked');
    if (!answer) {
      expect(result.outputSafety.recoveryFailureCode).toBe('invalid_slots');
      expect(result.segments).toEqual([]);
    }
    expect(result.toolCalls).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[1].tools ?? []).toHaveLength(0);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).not.toContain('documentos_rescisao');
  });

  it.each([
    'Entendi. [salvar_dados] {"documentos_rescisao":"[vídeo]',
    '[salvar_dados] {"tempo_carteira":"x",}\nPergunta ao cliente?',
    '[salvar_dados] {"tempo_carteira":"x"}\n{"campo":"privado"}',
    '[salvar_dados] {"tempo_carteira":"x"}\n"campo": "privado"',
  ])('bloqueia a saída inteira quando os limites do objeto ou da fala são ambíguos', async draft => {
    const model = queuedModel([text(draft)]);
    const result = await generateAgentReply({ ...input, model });
    expect(result.text).toBe('');
    expect(result.segments).toEqual([]);
    expect(result.toolCalls).toEqual([]);
    expect(result.outputSafety).toMatchObject({ status: 'blocked', recoveryFailureCode: 'internal_content' });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('revalida os marcadores na fala restante e também limpa uma anotação na revisão', async () => {
    const draft = 'Pergunta ao cliente? [instrução interna]\n' + savedAnnotation;
    const replacement = 'Em que data você saiu da empresa?';
    const model = queuedModel([text(draft), text(JSON.stringify({ replacements: [{ id: 0, text: savedAnnotation + '\n' + replacement }] }))]);
    const result = await generateAgentReply({ ...input, model });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[1].tools ?? []).toHaveLength(0);
    expect(result.text).toBe(replacement);
    expect(result.toolCalls).toEqual([]);
  });

  it('entrega ao modelo os trechos da base selecionada antes da resposta ao cliente', async () => {
    const id = '39333333-3333-4333-8333-333333333333';
    const configured = normalizeAgentRow({ ...agent, custom_actions: [{
      key: 'precos', label: 'Preços', description: 'Quando perguntarem pelo valor',
      actions: [{ type: 'consult_knowledge', knowledgeId: id, description: 'Preço da consulta inicial' }],
    }] });
    const model = queuedModel([
      response([{ type: 'tool-call', toolCallId: 'pesquisa', toolName: 'executar_acao',
        input: JSON.stringify({ acao: 'precos', detalhes: 'Quanto custa a consulta inicial?' }) }]),
      text('A consulta inicial custa R$ 80.'),
    ]);
    const searchKnowledge = vi.fn().mockResolvedValue([{ document_id: id, content: 'Consulta inicial: R$ 80.', idx: 0, score: 1 }]);
    const result = await generateAgentReply({
      ...input, agent: configured, model,
      runtime: {
        documents: [{ id, name: 'Tabela atual', status: 'ready', agent_id: agent.id, organization_id: agent.organization_id } as AgentDocumentRow],
        searchKnowledge,
      },
    });
    expect(searchKnowledge).toHaveBeenCalledExactlyOnceWith('Quanto custa a consulta inicial?', id);
    const sources = model.doGenerateCalls[1].prompt.filter(message => message.role === 'tool');
    expect(JSON.stringify(sources)).toContain('Consulta inicial: R$ 80.');
    expect(result.text).toBe('A consulta inicial custa R$ 80.');
  });

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
    const model = queuedModel([text('{"dados":{}}'), text('JSON inválido PAYLOAD_PRIVADO')]);
    const result = await generateAgentReply({ ...input, model });
    expect(result.outputSafety).toMatchObject({ status: 'blocked', recoveryFailureCode: 'parse_or_provider_failure',
      blockedSamples: [{ phase: 'original', segment: 0, step: 0, field: 'text', reason: 'internal_data', excerpt: '{"dados":{}}' }] });
    expect(JSON.stringify(result.outputSafety)).not.toContain('PAYLOAD_PRIVADO');
    expect(result.text).toBe('');
    expect(result.segments).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(2);
  });
  it('guarda somente amostras limitadas quando a revisão estruturada real ainda contém instruções internas', async () => {
    const original = '[instrução interna]' + 'a'.repeat(600);
    const review = 'salvar_dados ' + 'b'.repeat(600);
    const model = queuedModel([text(original), text(JSON.stringify({ replacements: [{ id: 0, text: review }] }))]);
    const result = await generateAgentReply({ ...input, model });
    expect(result.outputSafety).toMatchObject({ status: 'blocked', recoveryFailureCode: 'internal_content',
      blockedSamples: [
        { phase: 'original', segment: 0, field: 'text', reason: 'internal_marker', excerpt: original.slice(0, 500) },
        { phase: 'review', segment: 0, field: 'text', reason: 'tool_call', excerpt: review.slice(0, 500) },
      ] });
    expect(result.text).toBe('');
    expect(result.segments).toEqual([]);
    expect(result.toolCalls).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[1].tools ?? []).toHaveLength(0);
  });
});
