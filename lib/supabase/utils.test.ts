import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidUUID, requireUUID, sanitizeUUID, sanitizeUUIDs } from './utils';

// Mesmo formato dos ids que o lead automático do WhatsApp grava (versão 8).
const AUTO_LEAD_ID = 'a1b2c3d4-e5f6-8a7b-9c0d-1e2f3a4b5c6d';
const DATABASE_ID = '3f2b8c1e-5d4a-4c9b-9e7a-1b2c3d4e5f60';
const withVersion = (version: string) => `00000000-0000-${version}000-8000-000000000001`;
const withVariant = (variant: string) => `00000000-0000-4000-${variant}000-000000000001`;

afterEach(() => vi.restoreAllMocks());

describe('isValidUUID', () => {
  it.each(['1', '2', '3', '4', '5', '6', '7', '8'])('aceita UUID versão %s', version => {
    expect(isValidUUID(withVersion(version))).toBe(true);
  });

  it('aceita o id versão 8 gravado pelo lead automático', () => {
    expect(isValidUUID(AUTO_LEAD_ID)).toBe(true);
    expect(isValidUUID(AUTO_LEAD_ID.toUpperCase())).toBe(true);
  });

  it.each(['8', '9', 'a', 'b'])('aceita a variante %s', variant => {
    expect(isValidUUID(withVariant(variant))).toBe(true);
  });

  it.each(['0', '9', 'a', 'f'])('recusa a versão %s, que não existe na RFC 9562', version => {
    expect(isValidUUID(withVersion(version))).toBe(false);
  });

  it.each(['0', '7', 'c', 'f'])('recusa a variante %s', variant => {
    expect(isValidUUID(withVariant(variant))).toBe(false);
  });

  it.each([
    ['UUID nulo', '00000000-0000-0000-0000-000000000000'],
    ['UUID máximo', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ['texto solto', 'abc'],
    ['vazio', ''],
    ['só espaços', '   '],
    ['sem hifens', DATABASE_ID.replace(/-/g, '')],
    ['com espaço em volta', ` ${DATABASE_ID} `],
    ['com quebra de linha no fim', `${DATABASE_ID}\n`],
    ['com filtro extra colado', `${DATABASE_ID},id.neq.x`],
    ['com caractere fora do hexadecimal', 'g1b2c3d4-e5f6-8a7b-9c0d-1e2f3a4b5c6d'],
  ])('recusa %s', (_label, value) => {
    expect(isValidUUID(value)).toBe(false);
  });

  it.each([null, undefined, 123, {}, []])('recusa o que não é texto (%j)', value => {
    expect(isValidUUID(value)).toBe(false);
  });
});

describe('sanitizeUUID', () => {
  it('mantém o id versão 8 em vez de trocá-lo por null', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(sanitizeUUID(AUTO_LEAD_ID)).toBe(AUTO_LEAD_ID);
    expect(sanitizeUUID(DATABASE_ID)).toBe(DATABASE_ID);
    expect(warn).not.toHaveBeenCalled();
  });

  it('devolve null sem aviso para campo vazio', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(sanitizeUUID('')).toBeNull();
    expect(sanitizeUUID('  ')).toBeNull();
    expect(sanitizeUUID(null)).toBeNull();
    expect(sanitizeUUID(undefined)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('descarta com aviso o que não é UUID', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(sanitizeUUID('nao-e-uuid')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('sanitizeUUIDs', () => {
  it('preserva vínculos com id versão 8 e limpa só os inválidos', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const form = { contactId: AUTO_LEAD_ID, boardId: DATABASE_ID, companyId: '', ownerId: 'x', name: 'Teste' };
    expect(sanitizeUUIDs(form, ['contactId', 'boardId', 'companyId', 'ownerId'])).toEqual({
      contactId: AUTO_LEAD_ID,
      boardId: DATABASE_ID,
      companyId: null,
      ownerId: null,
      name: 'Teste',
    });
  });
});

describe('requireUUID', () => {
  it('devolve o id versão 8', () => {
    expect(requireUUID(AUTO_LEAD_ID, 'Deal ID')).toBe(AUTO_LEAD_ID);
  });

  it('lança erro com o nome do campo quando o valor não é UUID', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => requireUUID('nao-e-uuid', 'Deal ID')).toThrow('Deal ID é obrigatório e deve ser um UUID válido');
    expect(() => requireUUID('', 'Deal ID')).toThrow('Deal ID é obrigatório e deve ser um UUID válido');
  });
});
