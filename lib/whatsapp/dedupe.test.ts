import { beforeEach, describe, expect, it, vi } from 'vitest';

const teardown = vi.hoisted(() => ({ logout: vi.fn(), deleted: [] as string[] }));
vi.mock('@/lib/whatsapp', () => ({
  envEvolution: () => ({ baseUrl: 'https://evo.test' }),
  getProvider: () => ({ logout: teardown.logout }),
  isBusinessConnection: (c: { provider?: string }) => ['evolution_business', 'meta_cloud'].includes(String(c.provider)),
}));
vi.mock('@/lib/whatsapp/admin', () => ({
  deleteEvolutionInstance: async (name: string) => {
    teardown.deleted.push(name);
  },
}));

import { enforceOneConnectionPerNumber, findConnectedSameNumber, phoneKey } from './dedupe';
import type { WaConnectionRow } from './service';

type Row = Record<string, unknown>;

/** Supabase falso em memória: só o pedaço do query builder que o dedupe usa. */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: Row = {};
    let returning = false;
    const rows = () => (tables[table] ??= []);
    const b = {
      select: () => {
        if (op !== 'select') returning = true;
        return b;
      },
      update: (p: Row) => ((op = 'update'), (patch = p), b),
      delete: () => ((op = 'delete'), b),
      eq: (c: string, v: unknown) => (filters.push(r => r[c] === v), b),
      is: (c: string, v: unknown) => (filters.push(r => (r[c] ?? null) === v), b),
      in: (c: string, vs: unknown[]) => (filters.push(r => vs.includes(r[c])), b),
      contains: (c: string, vs: unknown[]) =>
        (filters.push(r => vs.every(v => ((r[c] as unknown[] | null) ?? []).includes(v))), b),
      then: (resolve: (v: { data: Row[] | null; error: null }) => void) => {
        const hit = rows().filter(r => filters.every(f => f(r)));
        if (op === 'update') hit.forEach(r => Object.assign(r, patch));
        if (op === 'delete') {
          tables[table] = rows().filter(r => !hit.includes(r));
          // FK SET NULL das conversas
          if (table === 'wa_connections') {
            for (const c of tables.wa_conversations ?? []) if (hit.some(h => h.id === c.connection_id)) c.connection_id = null;
          }
        }
        resolve({ data: op === 'select' || returning ? hit.map(r => ({ ...r })) : null, error: null });
      },
    };
    return b;
  };
  return { from } as never;
}

const conn = (over: Partial<WaConnectionRow> & { created_at?: string }): WaConnectionRow =>
  ({
    organization_id: 'org',
    provider: 'evolution',
    base_url: 'https://evo.test',
    instance_token: 't',
    profile_name: null,
    webhook_secret: 's',
    meta_phone_number_id: null,
    meta_waba_id: null,
    meta_app_id: null,
    meta_app_secret: null,
    ...over,
  }) as WaConnectionRow;

const conv = (id: string, connection_id: string | null, wa_phone: string, extra: Row = {}): Row => ({
  id,
  organization_id: 'org',
  connection_id,
  wa_phone,
  is_group: false,
  contact_id: null,
  deal_id: null,
  assigned_owner_id: null,
  label_ids: [],
  unread_count: 0,
  last_message_at: null,
  last_message_preview: null,
  ...extra,
});

describe('número único por organização', () => {
  beforeEach(() => {
    teardown.deleted = [];
    teardown.logout.mockReset();
  });

  it('trata as grafias com e sem o nono dígito como o mesmo número', () => {
    expect(phoneKey('+556791278454')).toBe(phoneKey('+5567991278454'));
    expect(phoneKey(null)).toBeNull();
    const conns = [conn({ id: 'a', instance_name: 'a', phone_number: '+5567991278454', status: 'connected', last_connected_at: null })];
    expect(findConnectedSameNumber(conns, '+556791278454')?.id).toBe('a');
    expect(findConnectedSameNumber(conns, '+556791278454', 'a')).toBeNull();
  });

  it('unifica duas conexões QR do mesmo número e mantém todo o histórico', async () => {
    const old = conn({ id: 'old', instance_name: 'inst_old', phone_number: '+556791278454', status: 'connected', last_connected_at: '2026-09-15T20:21:00Z' });
    const neu = conn({ id: 'new', instance_name: 'inst_new', phone_number: '+556791278454', status: 'connected', last_connected_at: '2026-09-15T21:09:00Z' });
    const tables: Record<string, Row[]> = {
      wa_connections: [{ ...old }, { ...neu }],
      wa_conversations: [
        // mesmo contato partido nas duas conexões (grafias diferentes do 9)
        conv('c-old', 'old', '+5567999115580', { contact_id: 'contato', unread_count: 1, last_message_at: '2026-09-15T20:19:00Z', last_message_preview: 'audio', label_ids: ['x'] }),
        conv('c-new', 'new', '+556799115580', { unread_count: 2, last_message_at: '2026-09-15T19:59:00Z', last_message_preview: 'tá joia então', label_ids: ['y'] }),
        // só na antiga
        conv('c-only', 'old', '+5511999990000'),
      ],
      wa_messages: [
        { id: 'm1', conversation_id: 'c-old' },
        { id: 'm2', conversation_id: 'c-new' },
        { id: 'm3', conversation_id: 'c-only' },
      ],
      wa_ai_agent_runs: [{ id: 'r1', conversation_id: 'c-old' }],
      wa_bot_runs: [],
      wa_bots: [{ id: 'b1', organization_id: 'org', connection_id: 'old', connection_ids: ['old'] }],
      wa_ai_agents: [
        { id: 'a1', organization_id: 'org', connection_ids: ['old'] },
        { id: 'a2', organization_id: 'org', connection_ids: ['old', 'new'] },
        { id: 'a3', organization_id: 'org', connection_ids: ['outro'] },
      ],
      message_templates: [{ id: 't1', connection_id: 'old' }],
    };

    const removed = await enforceOneConnectionPerNumber(fakeDb(tables), 'org', [old, neu]);

    // fica o pareamento mais recente; a antiga some e a instância dela é derrubada
    expect(removed).toEqual([{ id: 'old', phoneNumber: '+556791278454', duplicate: true, keptId: 'new' }]);
    expect(tables.wa_connections.map(c => c.id)).toEqual(['new']);
    expect(teardown.deleted).toEqual(['inst_old']);

    // conversa partida vira uma só, com as duas mensagens
    expect(tables.wa_conversations.map(c => c.id).sort()).toEqual(['c-new', 'c-only']);
    const unida = tables.wa_conversations.find(c => c.id === 'c-new')!;
    expect(unida).toMatchObject({
      connection_id: 'new',
      contact_id: 'contato',
      unread_count: 3,
      last_message_at: '2026-09-15T20:19:00Z',
      last_message_preview: 'audio',
    });
    expect(unida.label_ids).toEqual(['y', 'x']);
    expect(tables.wa_messages.every(m => m.conversation_id === 'c-new' || m.id === 'm3')).toBe(true);
    expect(tables.wa_ai_agent_runs[0].conversation_id).toBe('c-new');

    // conversa que só existia na antiga passa para a que ficou
    expect(tables.wa_conversations.find(c => c.id === 'c-only')!.connection_id).toBe('new');
    expect(tables.wa_bots[0].connection_id).toBe('new');
    expect(tables.wa_bots[0].connection_ids).toEqual(['new']);
    // agentes de IA passam a atender no número que ficou (sem repetir o id)
    expect(tables.wa_ai_agents.map(a => a.connection_ids)).toEqual([['new'], ['new'], ['outro']]);
    expect(tables.message_templates[0].connection_id).toBe('new');
  });

  it('linha desconectada do mesmo número (desconexão travada) é absorvida pela nova', async () => {
    const stuck = conn({ id: 'stuck', instance_name: 'inst_stuck', phone_number: '+5567991278454', status: 'disconnected', last_connected_at: '2026-09-01T00:00:00Z' });
    const neu = conn({ id: 'new', instance_name: 'inst_new', phone_number: '+556791278454', status: 'connected', last_connected_at: '2026-09-15T00:00:00Z' });
    const tables: Record<string, Row[]> = {
      wa_connections: [{ ...stuck }, { ...neu }],
      wa_conversations: [conv('c1', 'stuck', '+5511988887777')],
      wa_messages: [],
      wa_ai_agent_runs: [],
      wa_bot_runs: [],
      wa_bots: [],
      message_templates: [],
    };
    const removed = await enforceOneConnectionPerNumber(fakeDb(tables), 'org', [stuck, neu]);
    expect(removed).toEqual([{ id: 'stuck', phoneNumber: '+5567991278454', duplicate: false, keptId: 'new' }]);
    expect(tables.wa_conversations[0].connection_id).toBe('new');
  });

  it('não mexe em números diferentes, em número sem conexão ativa nem na API oficial', async () => {
    const a = conn({ id: 'a', instance_name: 'a', phone_number: '+5511911112222', status: 'connected', last_connected_at: null });
    const b = conn({ id: 'b', instance_name: 'b', phone_number: '+5511933334444', status: 'connected', last_connected_at: null });
    const c1 = conn({ id: 'c1', instance_name: 'c1', phone_number: '+5511955556666', status: 'disconnected', last_connected_at: null });
    const c2 = conn({ id: 'c2', instance_name: 'c2', phone_number: '+5511955556666', status: 'disconnected', last_connected_at: null });
    const api = conn({ id: 'api', instance_name: 'api', provider: 'meta_cloud', phone_number: '+5511977778888', status: 'connected', last_connected_at: '2026-01-01T00:00:00Z' });
    const qr = conn({ id: 'qr', instance_name: 'qr', phone_number: '+5511977778888', status: 'connected', last_connected_at: '2026-09-01T00:00:00Z' });
    const tables: Record<string, Row[]> = {
      wa_connections: [a, b, c1, c2, api, qr].map(x => ({ ...x })),
      wa_conversations: [],
      wa_messages: [],
      wa_ai_agent_runs: [],
      wa_bot_runs: [],
      wa_bots: [],
      message_templates: [],
    };
    const removed = await enforceOneConnectionPerNumber(fakeDb(tables), 'org', [a, b, c1, c2, api, qr]);
    // só o QR repetido da API oficial sai; a API oficial fica mesmo sendo a mais antiga
    expect(removed.map(r => r.id)).toEqual(['qr']);
    expect(tables.wa_connections.map(c => c.id)).toEqual(['a', 'b', 'c1', 'c2', 'api']);
  });

  it('duas telas ao mesmo tempo não unificam em dobro', async () => {
    const old = conn({ id: 'old', instance_name: 'inst_old', phone_number: '+556791278454', status: 'connected', last_connected_at: '2026-09-15T20:00:00Z' });
    const neu = conn({ id: 'new', instance_name: 'inst_new', phone_number: '+556791278454', status: 'connected', last_connected_at: '2026-09-15T21:00:00Z' });
    const tables: Record<string, Row[]> = {
      wa_connections: [{ ...old }, { ...neu }],
      wa_conversations: [conv('c-old', 'old', '+5511900001111', { unread_count: 1 }), conv('c-new', 'new', '+5511900001111', { unread_count: 1 })],
      wa_messages: [],
      wa_ai_agent_runs: [],
      wa_bot_runs: [],
      wa_bots: [],
      message_templates: [],
    };
    const db = fakeDb(tables);
    await enforceOneConnectionPerNumber(db, 'org', [old, neu]);
    const second = await enforceOneConnectionPerNumber(db, 'org', [old, neu]);
    expect(second).toEqual([]);
    expect(tables.wa_conversations).toHaveLength(1);
    expect(tables.wa_conversations[0].unread_count).toBe(2);
  });
});
