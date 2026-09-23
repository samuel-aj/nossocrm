import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareBulkBot } from './bulkBots';
vi.mock('./bots', () => ({ botConnectionIds: (b: { connection_ids?: string[]; connection_id: string }) => b.connection_ids?.length ? b.connection_ids : [b.connection_id].filter(Boolean) }));

function client({ connected = true, enabled = true, deals = [{ id: 'a', title: 'A', contact_id: 'c' }, { id: 'b', title: 'B', contact_id: 'd' }, { id: 'e', title: 'E', contact_id: 'f' }] } = {}) {
  const filters: unknown[][] = [];
  const data: Record<string, unknown> = {
    wa_bots: { id: 'bot', enabled, name: 'Follow-up', connection_ids: ['conn'], trigger: {}, steps: [{ type: 'send_text' }] },
    wa_connections: { id: 'conn', status: connected ? 'connected' : 'disconnected' },
    deals,
    contacts: [{ id: 'c', phone: '+5511999990000' }, { id: 'd', phone: '(11) 99999-0000' }, { id: 'f', phone: null }],
  };
  const admin = { from: (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select','eq','in','is','maybeSingle']) builder[method] = (...args: unknown[]) => { filters.push([table, method, ...args]); return builder; };
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: data[table], error: null });
    return builder;
  } } as unknown as SupabaseClient;
  return { admin, filters };
}
describe('bulk bot recipient review', () => {
  it('deduplicates normalized phones, rejects missing phones and inaccessible leads', async () => {
    const { admin, filters } = client();
    const { recipients } = await prepareBulkBot(admin, 'org', 'bot', ['a','b','e','outside']);
    expect(recipients.map(r => r.eligible)).toEqual([true,false,false,false]);
    expect(recipients[1].reason).toContain('repetido');
    expect(recipients[2].reason).toContain('telefone');
    expect(recipients[3].title).toBe('Lead indisponível');
    for (const table of ['wa_bots','wa_connections','deals','contacts']) expect(filters).toContainEqual([table,'eq','organization_id','org']);
  });
  it('rejects a disabled robot and a disconnected sender before enqueueing', async () => {
    await expect(prepareBulkBot(client({ enabled: false }).admin,'org','bot',['a'])).rejects.toThrow('ativo');
    await expect(prepareBulkBot(client({ connected: false }).admin,'org','bot',['a'])).rejects.toThrow('desconectado');
  });
});
