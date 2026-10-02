import { describe, expect, it } from 'vitest';
import { agentHistoryText, internalOutputReason, prepareReplyOutput } from './replyOutput';

describe('conteúdo interno na saída', () => {
  it.each([
    '{"dados":{"nome":"Teste"}}',
    'Olá!\n```json\n{"dados":{"nome":"Teste"}}\n```',
    'Antes {"dados":{"nome":"Teste"}} depois',
    '{dados: {nome: "Teste"}}',
    '{"dados":',
    '{"ok":true,"dados":{"nome":"Teste"}}',
    '{\\"dados\\":{\\"nome\\":\\"Teste\\"}}',
    'salvar_dados({"nome":"Teste"})',
    '{"tool_calls":[]}',
    '{"name":"executar_acao","arguments":{}}',
    '<<<dados>>>{"nome":"Teste"}<<<fim>>>',
    '{"proxima_pergunta":"renda"}',
  ])('bloqueia envelope ou marcador interno: %s', text => {
    expect(internalOutputReason(text)).not.toBeNull();
    expect(prepareReplyOutput([{ kind: 'text', text: 'Mensagem anterior' }, { kind: 'text', text }]).segments).toEqual([]);
    expect(agentHistoryText(text)).toBe('');
  });
  it.each(['Pode informar seus dados?', 'Use {nome} no modelo.', '{"renda":1500,"moradores":3}', 'Seus dados: nome e telefone.', 'Posso continuar?'])('preserva conteúdo comum: %s', text => {
    expect(internalOutputReason(text)).toBeNull();
    expect(agentHistoryText(text)).toBe(text);
  });
  it('verifica legenda antes de liberar o texto anterior', () => {
    const output = prepareReplyOutput([{ kind: 'text', text: 'Segue o arquivo.' }, { kind: 'media', name: 'Documento', caption: '{"dados":{}}', step: 2 }]);
    expect(output.segments).toEqual([]);
    expect(output.issues).toEqual([{ segment: 1, step: 2, field: 'caption', reason: 'internal_data' }]);
  });
  it('remove cópias dentro da mesma resposta e mantém diferenças de valor e perguntas', () => {
    expect(prepareReplyOutput([{ kind: 'text', text: 'Qual a renda?\nQual a renda?\nR$ 100\nR$ 1000\nQuantas pessoas?' }]).text)
      .toBe('Qual a renda?\nR$ 100\nR$ 1000\nQuantas pessoas?');
  });
  it('mantém a ordem da mídia, sem duplicar sua legenda no texto', () => {
    const output = prepareReplyOutput([
      { kind: 'text', text: 'Vou explicar.\nVeja o documento.' },
      { kind: 'media', name: 'Documento', caption: 'Veja o documento.' },
      { kind: 'text', text: 'Vou explicar.\nConseguiu abrir?' },
    ]);
    expect(output.segments).toEqual([
      { kind: 'text', text: 'Vou explicar.', step: undefined },
      { kind: 'media', name: 'Documento', caption: 'Veja o documento.' },
      { kind: 'text', text: 'Conseguiu abrir?', step: undefined },
    ]);
  });
  it('não compartilha a deduplicação entre respostas ou altera o histórico recebido', () => {
    const segments = [{ kind: 'text' as const, text: 'Posso continuar?' }];
    expect(prepareReplyOutput(segments).text).toBe(prepareReplyOutput(segments).text);
    expect(segments[0].text).toBe('Posso continuar?');
    expect(agentHistoryText('[SEM_RESPOSTA]')).toBe('');
  });
});
