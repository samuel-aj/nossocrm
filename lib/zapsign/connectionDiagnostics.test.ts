import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectionFailureMessage, logConnectionFailure, type ConnectionStage } from './connectionDiagnostics';

const reference = '83ca6542-82cc-4bd0-a516-cab56420603b';
const stages: ConnectionStage[] = [
  'authorization', 'validation', 'client', 'templates',
  'settings', 'webhook_secret', 'webhook', 'persist',
];

function capture() {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return {
    spy,
    output: () => JSON.stringify(spy.mock.calls),
    entry: () => spy.mock.calls[0]?.[1] as Record<string, unknown>,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('ZapSign connection diagnostics', () => {
  it('redacts every supplied credential, including short and punctuated secrets', () => {
    const log = capture();
    const credentials = [
      'api.token-short+123',
      'zs_private_webhook_456',
      'bypass/with+punctuation=',
    ];
    logConnectionFailure('persist', reference, {
      name: 'Error',
      message: `Database refused ${credentials.join('; ')}; repeat ${credentials[0]}`,
    }, credentials);
    for (const credential of credentials) expect(log.output()).not.toContain(credential);
    expect(log.entry().message).toContain('[redacted]');
    expect(log.entry().message).toContain('Database refused');
  });

  it('redacts bearer credentials, JWTs, long tokens and URLs without a supplied secrets list', () => {
    const log = capture();
    const bearer = 'short-secret';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.private-signature';
    const token = 'abcdefghijklmnopqrstuvwxyz1234567890';
    const url = 'https://provider.test/private?token=short-url-secret';
    logConnectionFailure('templates', reference, new Error(`Authorization: bEaReR ${bearer}; jwt=${jwt}; key=${token}; url=${url}`));
    for (const value of [bearer, jwt, token, url, 'short-url-secret', 'provider.test']) {
      expect(log.output()).not.toContain(value);
    }
    expect(log.entry().message).toContain('[redacted]');
    expect(log.entry().message).toContain('[url]');
  });

  it('never reads or serializes provider bodies, DB details, hints, stacks or causes', () => {
    const log = capture();
    const forbiddenRead = vi.fn(() => { throw new Error('diagnostics read a secret-bearing field'); });
    const error = { name: 'ZapSignError', message: 'Upstream unavailable', code: 'PGRST301', status: 503 };
    for (const property of ['body', 'details', 'hint', 'stack', 'cause', 'request', 'response']) {
      Object.defineProperty(error, property, { enumerable: true, get: forbiddenRead });
    }
    Object.defineProperty(error, 'toJSON', { value: forbiddenRead });
    expect(() => logConnectionFailure('templates', reference, error)).not.toThrow();
    expect(forbiddenRead).not.toHaveBeenCalled();
    expect(log.entry()).toEqual({
      reference, stage: 'templates', name: 'ZapSignError',
      code: 'PGRST301', status: 503, message: 'Upstream unavailable',
    });
  });

  it.each(['PRIVATE_BYPASS_12345', 'AB123'])('does not leak a known secret from the provider error code (%s)', secret => {
    const log = capture();
    logConnectionFailure('persist', reference, { message: 'Save failed', code: secret }, [secret]);
    expect(log.output()).not.toContain(secret);
  });

  it('drops arbitrary names and codes instead of logging their contents', () => {
    const log = capture();
    logConnectionFailure('client', reference, {
      name: 'private-provider-name', code: 'Bearer private-provider-token',
      status: 'private-status', message: 'Safe diagnostic',
    });
    expect(log.entry()).toMatchObject({ name: 'Error', message: 'Safe diagnostic' });
    expect(log.entry().code).toBeUndefined();
    expect(log.entry().status).toBeUndefined();
    expect(log.output()).not.toMatch(/private-provider|private-status/);
  });

  it.each(stages)('preserves correlation and the %s stage with safe error metadata', stage => {
    const log = capture();
    logConnectionFailure(stage, reference, { name: 'TypeError', code: '23505', status: 500, message: 'Safe failure' });
    expect(log.spy).toHaveBeenCalledTimes(1);
    expect(log.spy.mock.calls[0]?.[0]).toBe('[zapsign.connect]');
    expect(log.entry()).toEqual({ reference, stage, name: 'TypeError', code: '23505', status: 500, message: 'Safe failure' });
  });

  it.each([null, undefined, 'private thrown string', 42, {}, { message: { api_token: 'private token' } }])(
    'uses a safe fallback for errors without a string message (%j)', error => {
      const log = capture();
      expect(() => logConnectionFailure('authorization', reference, error)).not.toThrow();
      expect(log.entry()).toMatchObject({ name: 'Error', message: 'Unknown connection error' });
      expect(log.output()).not.toContain('private');
    },
  );

  it('bounds message length after redaction', () => {
    const log = capture();
    const secret = 'secret-at-boundary';
    logConnectionFailure('webhook', reference, new Error(`Safe note. ${'x '.repeat(190)}${secret} ${'detail '.repeat(100)}`), [secret]);
    expect(String(log.entry().message).length).toBeLessThanOrEqual(400);
    expect(log.output()).not.toContain(secret);
  });
});

describe('ZapSign connection failure messages', () => {
  it.each([
    ['authorization', 'verificar sua sessão'],
    ['persist', 'salvar a conexão'],
    ['settings', 'ler a configuração da integração'],
    ['validation', 'concluir a conexão'],
    ['client', 'concluir a conexão'],
    ['templates', 'concluir a conexão'],
    ['webhook_secret', 'concluir a conexão'],
    ['webhook', 'concluir a conexão'],
  ] as const)('identifies %s without exposing provider data', (stage, operation) => {
    const message = connectionFailureMessage(stage, reference);
    expect(message).toContain(operation);
    expect(message).toContain(`Referência: ${reference}.`);
    expect(message).toContain('suporte antes de tentar novamente');
  });
});
