/**
 * O autor (robô, agente, integração) precisa chegar no banco em TODA gravação
 * feita pelo cliente marcado: o histórico do lead depende disso.
 */
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { withActor } from './actorClient';

function clientCapturing(seen: Array<{ url: string; headers: Headers }>) {
  return createClient('https://exemplo.supabase.co', 'chave-de-teste', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), headers: new Headers(init?.headers) });
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  });
}

describe('withActor', () => {
  it('manda o autor em update, insert, delete, select e rpc', async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const admin = withActor(clientCapturing(seen), { kind: 'bot', id: '00000000-0000-4000-8000-0000000000b1' });
    await admin.from('deals').update({ value: 1 }).eq('id', 'x');
    await admin.from('activities').insert({ title: 'a' });
    await admin.from('deal_items').delete().eq('id', 'x');
    await admin.from('deals').select('id').eq('id', 'x').maybeSingle();
    await admin.rpc('alguma_funcao', { a: 1 });
    expect(seen).toHaveLength(5);
    for (const s of seen) {
      expect(s.headers.get('x-crm-actor-kind')).toBe('bot');
      expect(s.headers.get('x-crm-actor-id')).toBe('00000000-0000-4000-8000-0000000000b1');
    }
  });

  it('não vaza para o cliente original', async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const base = clientCapturing(seen);
    withActor(base, { kind: 'agent' });
    await base.from('deals').update({ value: 1 }).eq('id', 'x');
    expect(seen[0].headers.get('x-crm-actor-kind')).toBeNull();
  });

  it('integração sem id manda só o tipo', async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    await withActor(clientCapturing(seen), { kind: 'integration' }).from('deals').update({ value: 2 }).eq('id', 'x');
    expect(seen[0].headers.get('x-crm-actor-kind')).toBe('integration');
    expect(seen[0].headers.get('x-crm-actor-id')).toBeNull();
  });
});
