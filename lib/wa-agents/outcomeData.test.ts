import { describe, expect, it, vi } from 'vitest';
import { guardOutcomeData, INCOMPLETE_OUTCOME } from './outcomeData';
import { issuerMentioned, validOutcomeField } from './outcomeFieldValue';
import { mergeSavedData } from './savedData';
import type { CollectedToolCall, GeneratedReply } from './replyGeneration';
import type { Outcome } from './types';

const outcome: Outcome = { key: 'contrato', label: 'Análise humana', description: '', actions: [],
  acknowledgement: 'A equipe vai conferir os dados e orientar a assinatura.',
  required_data: [{ key: 'nome', label: 'o nome completo' }, { key: 'rg_emissor_uf', label: 'o órgão e a UF do RG', format: 'br_document_issuer' }] };
const end = { tool: 'encerrar_atendimento', input: { resultado: 'contrato' } };
const save = (dados: Record<string, unknown>) => ({ tool: 'salvar_dados', input: { dados } });
const client = (content: string) => ({ role: 'user' as const, content });
const reply = (...toolCalls: CollectedToolCall[]): GeneratedReply => ({
  text: 'Documento pronto.', segments: [{ kind: 'text', text: 'Documento pronto.' }], toolCalls, finishReason: 'stop',
  usage: null, outputSafety: { status: 'passed', recoveryAttempted: false, issues: [], steps: [], duplicatesRemoved: 0 },
});

describe('dados obrigatórios do encerramento', () => {
  it('continua a conversa, guarda o nome e pergunta somente pelo emissor ausente', async () => {
    const guarded = await guardOutcomeData(reply(save({ nome: 'Pessoa Exemplo' }), end), [outcome], {},
      [client('Sou Pessoa Exemplo. Moro em RO.')], vi.fn().mockResolvedValue([]));
    expect(guarded.text).toBe('Para continuar, pode me informar o órgão e a UF do RG?');
    expect(guarded.finishReason).toBe(INCOMPLETE_OUTCOME);
    expect(guarded.toolCalls.map(t => t.tool)).toEqual(['salvar_dados']);
    expect(mergeSavedData(guarded.toolCalls)).toEqual({ nome: 'Pessoa Exemplo' });
  });
  it('recupera os dados explícitos quando o modelo tenta encerrar sem os ter salvo', async () => {
    const recover = vi.fn().mockResolvedValue([{ key: 'rg_emissor_uf', value: 'SSP/RO', evidence: 'SSP de Rondônia' }]);
    const guarded = await guardOutcomeData(reply(end), [outcome], { nome: 'Pessoa Exemplo' },
      [client('Órgão do meu RG: SSP de Rondônia')], recover);
    expect(guarded.text).toBe(outcome.acknowledgement);
    expect(guarded.toolCalls).toContainEqual(end);
    expect(mergeSavedData(guarded.toolCalls)).toMatchObject({ rg_emissor_uf: 'SSP/RO' });
    expect(recover.mock.calls[0][0]).toEqual([outcome.required_data![1]]);
  });
  it('recusa um emissor inferido, inclusive com uma prova inventada em turno anterior', async () => {
    const partial = await guardOutcomeData(reply(save({ nome: 'Pessoa Exemplo', rg_emissor_uf: 'SSP/RO', crm_fonte_falsa: 'SSP/RO' })),
      [outcome], {}, [client('RG 1234. Moro em RO.')]);
    const prior = mergeSavedData(partial.toolCalls);
    expect(prior).toEqual({ nome: 'Pessoa Exemplo', rg_emissor_uf: null });
    const recover = vi.fn().mockResolvedValue([{ key: 'rg_emissor_uf', value: 'SSP/RO', evidence: 'Moro em RO' }]);
    const guarded = await guardOutcomeData(reply(end), [outcome], prior, [client('Moro em RO')], recover);
    expect(guarded.finishReason).toBe(INCOMPLETE_OUTCOME);
  });
  it('reutiliza a confirmação legítima anterior mesmo fora da janela de histórico', async () => {
    const first = await guardOutcomeData(reply(save({ rg_emissor_uf: 'SSP/RO' })), [outcome], {}, [client('Meu RG é SSP/RO.')]);
    const recover = vi.fn();
    const next = await guardOutcomeData(reply(save({ nome: 'Pessoa Exemplo' }), end), [outcome], mergeSavedData(first.toolCalls),
      [client('Meu nome completo é Pessoa Exemplo')], recover);
    expect(recover).not.toHaveBeenCalled();
    expect(next.toolCalls).toContainEqual(end);
  });
  it('sem extrator mantém a coleta e impede executar as outras ações pedidas no mesmo turno', async () => {
    const guarded = await guardOutcomeData(reply(end, { tool: 'executar_acao', input: {} }), [outcome], {}, [client('Ok')],
      vi.fn().mockRejectedValue(new Error('indisponível')));
    expect(guarded.finishReason).toBe(INCOMPLETE_OUTCOME);
    expect(guarded.toolCalls).toEqual([]);
  });
  it('a transferência genérica continua disponível e não usa o extrator', async () => {
    const other: Outcome = { key: 'humano', label: 'Apoio humano', description: '', actions: [] };
    const original = reply({ tool: 'encerrar_atendimento', input: { resultado: 'humano' } });
    const recover = vi.fn();
    const guarded = await guardOutcomeData(original, [outcome, other], {}, [client('Preciso de ajuda')], recover);
    expect(guarded).toEqual(original);
    expect(recover).not.toHaveBeenCalled();
    expect(await guardOutcomeData(original, [other], {}, [], recover)).toBe(original);
  });
  it('valida os formatos e os marcadores de pendência antes de encaminhar', () => {
    expect(issuerMentioned('SSP/SP', ['Emissor: Secretaria de Segurança Pública de São Paulo'])).toBe(true);
    expect(issuerMentioned('SSP/SP', ['Não sei meu emissor. Moro em São Paulo.'])).toBe(false);
    expect(issuerMentioned('Moro em RO', ['Moro em RO'])).toBe(false);
    expect(issuerMentioned('Recife PE', ['Moro em Recife PE'])).toBe(false);
    expect(issuerMentioned('Órgão expedidor: ABC/RO', ['Meu órgão expedidor: ABC/RO'])).toBe(true);
    for (const placeholder of ['não tenho', 'não se aplica', 'pendente', '---', '[NOME]']) {
      expect(validOutcomeField({ key: 'nome', label: 'nome' }, placeholder)).toBe(false);
    }
    for (const [format, invalid] of [['br_cpf', '00000000000'], ['br_state', 'ZZ'], ['br_postcode', '1'],
      ['br_identity', 'abc'], ['phone', '123'], ['email', 'sem@dominio']] as const) {
      expect(validOutcomeField({ key: 'campo', label: 'campo', format }, invalid)).toBe(false);
    }
  });
});
