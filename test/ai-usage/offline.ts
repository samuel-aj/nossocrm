import { vi } from 'vitest';
vi.mock('server-only', () => ({}));
globalThis.fetch = (() => { throw new Error('Real network calls are forbidden in AI usage checks'); }) as typeof fetch;
