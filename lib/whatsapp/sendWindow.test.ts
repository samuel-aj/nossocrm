import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { checkSendWindow, META_WINDOW_CLOSED } from './sendWindow';

const now = Date.parse('2026-10-08T13:15:00Z');
function database(inbound: boolean, fail = false) {
  const urls: URL[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); urls.push(url);
    if (fail) return Response.json({ message: 'unavailable' }, { status: 500 });
    return Response.json(url.pathname.endsWith('/wa_conversations') ? [{ id: 'meta-conv' }] : inbound ? [{ id: 'reply' }] : []);
  });
  return { urls, fetcher, db: createClient('https://database.test', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  }) };
}
describe('server send window', () => {
  it('checks the selected sender and both Brazilian phone spellings before allowing text', async () => {
    const { db, urls } = database(true);
    expect(await checkSendWindow(db, 'org', { id: 'meta', provider: 'meta_cloud' }, '+551198765432', { now })).toBeNull();
    expect(urls[0].searchParams.get('organization_id')).toBe('eq.org');
    expect(urls[0].searchParams.get('connection_id')).toBe('eq.meta');
    expect(urls[0].searchParams.get('wa_phone')).toContain('+5511998765432');
    expect(urls[1].searchParams.get('conversation_id')).toBe('in.(meta-conv)');
    expect(urls[1].searchParams.get('direction')).toBe('eq.in');
    expect(urls[1].searchParams.get('or')).toContain('wa_timestamp.gt.2026-10-07T13:15:00.000Z');
    expect(urls[1].searchParams.get('or')).toContain('wa_timestamp.is.null,created_at.gt.');
    expect(urls[1].searchParams.get('or')).toContain('wa_timestamp.lte.2026-10-08T13:15:00.000Z');
  });
  it('blocks when no recent inbound exists, including replies only on another sender', async () => {
    const { db } = database(false);
    expect(await checkSendWindow(db, 'org', { id: 'meta', provider: 'meta_cloud' }, '+551198765432', { now })).toBe(META_WINDOW_CLOSED);
  });
  it.each([{ provider: 'evolution' }, { provider: 'meta_cloud', template: true }, { provider: 'meta_cloud', isGroup: true }])('does not block $provider templates/groups/QR', async ({ provider, ...options }) => {
    const { db, fetcher } = database(false);
    expect(await checkSendWindow(db, 'org', { id: 'sender', provider }, '+551198765432', options)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fails closed with an honest retry message if the database cannot verify the window', async () => {
    const { db } = database(false, true);
    expect(await checkSendWindow(db, 'org', { id: 'meta', provider: 'meta_cloud' }, '+551198765432', { now })).toContain('Não foi possível verificar');
  });
});
