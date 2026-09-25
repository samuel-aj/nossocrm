import { expect, it, vi } from 'vitest';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
vi.mock('@/lib/supabase/middleware', () => ({ updateSession: vi.fn() }));
import { config } from './proxy';

it('serves public cache assets without auth redirects while keeping CRM pages protected', () => {
  for (const url of ['/sw.js', '/sw.js?v=4', '/offline.html', '/_next/static/chunks/app.js']) {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  }
  for (const url of ['/boards', '/chats', '/contacts', '/settings', '/sw.js/private']) {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  }
});
