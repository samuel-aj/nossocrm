import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from './useWaAgents';

describe('apiErrorMessage', () => {
  it('usa a mensagem do servidor ou o status HTTP', () => {
    expect(apiErrorMessage({ error: 'Sem permissão' }, 403)).toBe('Sem permissão');
    expect(apiErrorMessage(null, 500)).toBe('Falha (HTTP 500)');
  });

  it('em validação de regra de negócio (issue custom) mostra a mensagem do problema, não "Dados inválidos"', () => {
    const body = {
      error: 'Dados inválidos',
      code: 'VALIDATION_ERROR',
      issues: [{ code: 'custom', path: ['name'], message: 'Já existe uma mídia com este nome neste agente' }],
    };
    expect(apiErrorMessage(body, 400)).toBe('Já existe uma mídia com este nome neste agente');
  });

  it('em problema do zod acrescenta o campo e uma descrição em pt-BR', () => {
    const body = {
      error: 'Dados inválidos',
      code: 'VALIDATION_ERROR',
      issues: [{ code: 'too_big', path: ['name'], message: 'String must contain at most 80 character(s)' }],
    };
    expect(apiErrorMessage(body, 400)).toBe('Dados inválidos (name): valor muito grande');
  });

  it('sem issues fica com a mensagem genérica', () => {
    expect(apiErrorMessage({ error: 'Dados inválidos', code: 'VALIDATION_ERROR', issues: [] }, 400)).toBe('Dados inválidos');
  });
});
