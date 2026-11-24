import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERIC_ERROR_MESSAGE, isDatabaseError, safeErrorMessage } from './safeError';

describe('safeErrorMessage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('esconde erro do PostgREST e troca por frase amigável', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "contacts_email_key"',
      details: 'Key (email)=(fulano@x.com) already exists.',
      hint: null,
    };
    expect(isDatabaseError(err)).toBe(true);
    const msg = safeErrorMessage(err);
    expect(msg).toBe('Já existe um registro com esses dados.');
    expect(msg).not.toContain('fulano');
  });

  it('usa a mensagem genérica para código de banco sem tradução', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = { code: '42P01', message: 'relation "public.x" does not exist', details: null, hint: null };
    expect(safeErrorMessage(err)).toBe(GENERIC_ERROR_MESSAGE);
  });

  it('reconhece erro do driver pg (detail/table)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('null value in column "name"'), { code: '23502', detail: 'Failing row contains (...)', table: 'deals' });
    expect(safeErrorMessage(err)).toBe('Falta preencher um campo obrigatório.');
  });

  it('mantém mensagem escrita pelo próprio CRM ou por integração', () => {
    expect(safeErrorMessage(new Error('Token da Meta inválido'))).toBe('Token da Meta inválido');
    expect(safeErrorMessage({ message: 'boom' })).toBe('boom');
    expect(safeErrorMessage('Texto pronto')).toBe('Texto pronto');
  });

  it('cai no texto padrão quando não há mensagem', () => {
    expect(safeErrorMessage(null)).toBe(GENERIC_ERROR_MESSAGE);
    expect(safeErrorMessage(undefined, 'Falhou')).toBe('Falhou');
    expect(safeErrorMessage(new Error(''))).toBe(GENERIC_ERROR_MESSAGE);
  });
});
