import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession: vi.fn(async () => ({ error: null })) },
  })),
}));

import { GET } from './route';

async function redirectFor(next: string): Promise<string> {
  const url = `https://crm.test/auth/callback?code=abc&next=${encodeURIComponent(next)}`;
  const res = await GET(new Request(url));
  return res.headers.get('location') ?? '';
}

describe('GET /auth/callback', () => {
  it('mantém caminho interno', async () => {
    expect(await redirectFor('/deals?x=1')).toBe('https://crm.test/deals?x=1');
  });

  it.each(['@evil.com', '//evil.com', '/\\evil.com', 'https://evil.com', '/x@evil.com'])(
    'troca destino externo (%s) pelo painel',
    async next => {
      expect(await redirectFor(next)).toBe('https://crm.test/dashboard');
    },
  );
});
