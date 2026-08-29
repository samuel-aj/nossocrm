import { describe, expect, it } from 'vitest';
import { orphanTokens, splitPromptTokens, type KnownTokens } from './tokens';

const known: KnownTokens = {
  vars: ['nome_lead', 'primeiro_nome', 'negocio.titulo'],
  actions: ['pediu_orcamento'],
  media: ['Tabela de preços'],
};

/** O destaque não pode perder, duplicar nem reordenar nada do texto. */
function juntar(text: string): string {
  return splitPromptTokens(text, known)
    .map(p => p.text)
    .join('');
}

describe('splitPromptTokens', () => {
  it('devolve o texto inteiro quando não há token', () => {
    const t = 'Olá, tudo bem?\n\nVamos começar.';
    expect(splitPromptTokens(t, known)).toEqual([{ kind: 'text', text: t }]);
  });

  it('marca variável conhecida e desconhecida', () => {
    const parts = splitPromptTokens('Oi {{nome_lead}}, aqui é {{nome_inventado}}.', known);
    expect(parts.filter(p => p.kind === 'var')).toEqual([
      { kind: 'var', text: '{{nome_lead}}', name: 'nome_lead', known: true },
      { kind: 'var', text: '{{nome_inventado}}', name: 'nome_inventado', known: false },
    ]);
  });

  it('marca ação e mídia pelos marcadores do roteiro', () => {
    const parts = splitPromptTokens('faça [[acao:pediu_orcamento]] e envie [[midia:Tabela de preços]]', known);
    const tokens = parts.filter(p => p.kind !== 'text');
    expect(tokens.map(p => [p.kind, 'known' in p ? p.known : null])).toEqual([
      ['acao', true],
      ['midia', true],
    ]);
  });

  it('compara mídia sem diferenciar acento e caixa (como o servidor)', () => {
    const [token] = splitPromptTokens('[[midia:tabela de precos]]', known).filter(p => p.kind === 'midia');
    expect(token).toMatchObject({ known: true });
  });

  it('não perde nem duplica texto', () => {
    const t = 'A {{nome_lead}} B [[acao:pediu_orcamento]] C {{quebrado}} D [[midia:Tabela de preços]] E';
    expect(juntar(t)).toBe(t);
    expect(juntar('')).toBe('');
    expect(juntar('{{}} {{ }} [[acao:]] texto solto')).toBe('{{}} {{ }} [[acao:]] texto solto');
  });

  it('variável com caixa diferente não existe (o servidor resolve pela chave exata)', () => {
    const [token] = splitPromptTokens('Olá {{Primeiro_Nome}}', known).filter(p => p.kind === 'var');
    expect(token).toMatchObject({ known: false, name: 'Primeiro_Nome' });
  });

  it('enquanto as mídias não carregaram, nenhum marcador de mídia é acusado', () => {
    const carregando = { ...known, media: [], mediaLoaded: false };
    const [token] = splitPromptTokens('[[midia:Tabela de preços]]', carregando).filter(p => p.kind === 'midia');
    expect(token).toMatchObject({ known: true });
    expect(orphanTokens('[[midia:Tabela de preços]]', carregando)).toEqual([]);
  });

  it('aceita espaços dentro das chaves, como o servidor', () => {
    const [token] = splitPromptTokens('{{  primeiro_nome  }}', known).filter(p => p.kind === 'var');
    expect(token).toMatchObject({ known: true, name: 'primeiro_nome' });
  });
});

describe('orphanTokens', () => {
  it('lista só os que não existem, uma vez cada', () => {
    const t = '{{nome_lead}} {{sumiu}} {{sumiu}} [[midia:Inexistente]] [[acao:pediu_orcamento]]';
    expect(orphanTokens(t, known)).toEqual([
      { kind: 'var', name: 'sumiu', text: '{{sumiu}}' },
      { kind: 'midia', name: 'Inexistente', text: '[[midia:Inexistente]]' },
    ]);
  });

  it('roteiro sem token não gera aviso', () => {
    expect(orphanTokens('Texto normal, sem variável.', known)).toEqual([]);
  });
});
