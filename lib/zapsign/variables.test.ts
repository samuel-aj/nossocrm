import { describe, expect, it } from 'vitest';
import { autoMatchVariable, extractTemplateVariables, resolveSource, resolveVariables, splitPhone, valorPorExtenso, type VariableContext } from './variables';

const ctx: VariableContext = {
  contact: { name: 'Maria da Silva Souza', email: 'maria@exemplo.com', phone: '+5511988887777', company: 'Padaria da Maria' },
  deal: {
    title: 'Aposentadoria por tempo',
    value: 4500.5,
    items: [
      { name: 'Consulta', quantity: 1, price: 300 },
      { name: 'Contrato', quantity: 2, price: 2100.25 },
    ],
    stage: 'Fechamento',
    board: 'Previdenciário',
    owner: 'Ana Lab',
    description: 'Cliente quer aposentar',
    customFields: { cpf: '123.456.789-00', nascimento: '1980-05-17', renda: 3500 },
  },
  customFieldTypes: { cpf: 'text', nascimento: 'date', renda: 'currency' },
  organizationName: 'Escritório Teste',
  now: new Date(2026, 9, 27, 10, 0, 0),
};

describe('variáveis do modelo', () => {
  it('extrai {{variáveis}} do texto do DOCX, sem repetir e aceitando espaços', () => {
    const text = 'Contratante: {{NOME COMPLETO}}, CPF {{ CPF }}. Valor: {{VALOR}} ({{VALOR EXTENSO}}). {{NOME COMPLETO}} assina em {{DATA}}.';
    expect(extractTemplateVariables(text)).toEqual(['NOME COMPLETO', 'CPF', 'VALOR', 'VALOR EXTENSO', 'DATA']);
  });

  it('sugere a origem pelo nome, preferindo campo personalizado de mesmo nome', () => {
    const fields = [{ key: 'cpf', label: 'CPF' }, { key: 'oab', label: 'Número da OAB' }];
    expect(autoMatchVariable('NOME COMPLETO', fields)).toBe('contato.nome');
    expect(autoMatchVariable('CPF', fields)).toBe('campo:cpf');
    expect(autoMatchVariable('Número da OAB', fields)).toBe('campo:oab');
    expect(autoMatchVariable('VALOR', fields)).toBe('negocio.valor');
    expect(autoMatchVariable('VALOR EXTENSO', fields)).toBe('negocio.valor_extenso');
    expect(autoMatchVariable('DATA', fields)).toBe('data.hoje');
    expect(autoMatchVariable('TELEFONE', fields)).toBe('contato.telefone');
    expect(autoMatchVariable('ESCRITÓRIO', fields)).toBe('escritorio.nome');
    expect(autoMatchVariable('FORO', fields)).toBe('');
  });

  it('resolve cada origem com os dados do lead', () => {
    expect(resolveSource('contato.nome', ctx)).toBe('Maria da Silva Souza');
    expect(resolveSource('contato.primeiro_nome', ctx)).toBe('Maria');
    expect(resolveSource('negocio.valor', ctx)).toMatch(/R\$\s?4\.500,50/);
    expect(resolveSource('negocio.valor_numero', ctx)).toBe('4500.5');
    expect(resolveSource('negocio.produtos_nomes', ctx)).toBe('Consulta, Contrato');
    expect(resolveSource('negocio.produtos', ctx)).toMatch(/Consulta \(1 x R\$\s?300,00\); Contrato \(2 x R\$\s?2\.100,25\)/);
    expect(resolveSource('campo:cpf', ctx)).toBe('123.456.789-00');
    expect(resolveSource('campo:nascimento', ctx)).toBe('17/05/1980');
    expect(resolveSource('campo:renda', ctx)).toMatch(/R\$\s?3\.500,00/);
    expect(resolveSource('campo:inexistente', ctx)).toBe('');
    expect(resolveSource('texto:São Paulo', ctx)).toBe('São Paulo');
    expect(resolveSource('data.hoje', ctx)).toBe('27/10/2026');
    expect(resolveSource('data.hoje_extenso', ctx)).toBe('27 de outubro de 2026');
    expect(resolveSource('escritorio.nome', ctx)).toBe('Escritório Teste');
    expect(resolveSource('', ctx)).toBe('');
  });

  it('monta a lista no formato da ZapSign, com valor editado na hora por cima', () => {
    const out = resolveVariables({ NOME: 'contato.nome', FORO: 'texto:Comarca de SP', CIDADE: '' }, ctx, { NOME: 'Maria S. Souza' });
    expect(out).toEqual([
      { de: '{{NOME}}', para: 'Maria S. Souza' },
      { de: '{{FORO}}', para: 'Comarca de SP' },
      { de: '{{CIDADE}}', para: '' },
    ]);
  });

  it('valor por extenso para contrato', () => {
    expect(valorPorExtenso(4500.5)).toBe('quatro mil e quinhentos reais e cinquenta centavos');
    expect(valorPorExtenso(1)).toBe('um real');
    expect(valorPorExtenso(100)).toBe('cem reais');
    expect(valorPorExtenso(1000)).toBe('mil reais');
    expect(valorPorExtenso(1250000)).toBe('um milhão duzentos e cinquenta mil reais');
    expect(valorPorExtenso(0.07)).toBe('zero reais e sete centavos');
  });

  it('separa o telefone em país e número como a ZapSign pede', () => {
    expect(splitPhone('+5511988887777')).toEqual({ country: '55', number: '11988887777' });
    expect(splitPhone('+551188887777')).toEqual({ country: '55', number: '1188887777' });
    expect(splitPhone('+351912345678')).toEqual({ country: '351', number: '912345678' });
    expect(splitPhone('+12025550123')).toEqual({ country: '1', number: '2025550123' });
    expect(splitPhone('')).toEqual({ country: '', number: '' });
  });
});
