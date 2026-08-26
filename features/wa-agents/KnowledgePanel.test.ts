import { describe, it, expect } from 'vitest';
import { cleanMediaName, mediaNameTaken, uniqueMediaName } from './KnowledgePanel';

describe('cleanMediaName', () => {
  it('remove colchetes (quebrariam o marcador [[midia:nome]]) e espaços repetidos', () => {
    expect(cleanMediaName('foto[1]')).toBe('foto1');
    expect(cleanMediaName('  tabela   de  preços ')).toBe('tabela de preços');
    expect(cleanMediaName('[[x]]')).toBe('x');
  });
});

describe('mediaNameTaken', () => {
  it('compara como o servidor: sem acento e sem diferenciar maiúsculas', () => {
    expect(mediaNameTaken('tabela de precos', ['Tabela de preços'])).toBe(true);
    expect(mediaNameTaken('TABELA  de preços', ['tabela de preços'])).toBe(true);
    expect(mediaNameTaken('tabela 2026', ['tabela de preços'])).toBe(false);
  });
});

describe('uniqueMediaName', () => {
  it('devolve o nome limpo quando ainda não existe', () => {
    expect(uniqueMediaName('Contrato', [])).toBe('Contrato');
    expect(uniqueMediaName('   ', [])).toBe('midia');
  });

  it('acrescenta (n) quando o nome já existe, mesmo diferindo só por acento ou caixa', () => {
    expect(uniqueMediaName('tabela de precos', ['Tabela de preços'])).toBe('tabela de precos (2)');
    expect(uniqueMediaName('Foto', ['foto', 'FOTO (2)'])).toBe('Foto (3)');
  });

  it('nunca gera nome com colchetes', () => {
    expect(uniqueMediaName('foto[1]', [])).toBe('foto1');
  });
});
