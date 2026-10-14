import { vi } from 'vitest';
vi.mock('server-only', () => ({}));
// Fail any accidental external call. Individual provider tests replace fetch with their mock.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('External network forbidden in MCP tests');
  return nativeFetch(input, init);
};
