// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { Api4comError, type Api4comClient } from './client';
import { connectUser, disconnectUser, friendlyCallError, handleApi4comWebhook, normalizeCalled, startCall, webhookDedupeKey } from './calls';
import { formatDuration, resultFor } from './shared';

type Row = Record<string, unknown>;

/** Banco falso com o que o serviço usa: select/eq, insert, update, upsert, delete. */
function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0;
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let single = false;
    let op: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
    let payload: Row | null = null;
    let conflict: string[] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      order: () => b,
      limit: () => b,
      maybeSingle: () => ((single = true), b),
      single: () => ((single = true), b),
      update: (p: Row) => ((op = 'update'), (payload = p), b),
      insert: (p: Row) => ((op = 'insert'), (payload = p), b),
      upsert: (p: Row, o?: { onConflict?: string }) => ((op = 'upsert'), (payload = p), (conflict = (o?.onConflict ?? '').split(',')), b),
      delete: () => ((op = 'delete'), b),
      then: (resolve: (v: unknown) => void) => {
        tables[table] ??= [];
        const list = tables[table];
        if (op === 'insert') {
          const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date().toISOString(), ...payload };
          list.push(row);
          return resolve({ data: single ? row : [row], error: null });
        }
        if (op === 'upsert') {
          const hit = list.find((r) => conflict.every((k) => r[k] === (payload as Row)[k]));
          if (hit) Object.assign(hit, payload);
          else list.push({ ...payload });
          return resolve({ data: hit ?? list[list.length - 1], error: null });
        }
        const rows = list.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          for (const r of rows) Object.assign(r, payload);
          return resolve({ data: rows, error: null });
        }
        if (op === 'delete') {
          tables[table] = list.filter((r) => !rows.includes(r));
          return resolve({ data: null, error: null });
        }
        resolve({ data: single ? rows[0] ?? null : rows, error: null });
      },
    };
    return b;
  };
  return { admin: { from } as never, tables };
}

type Calls = { me: number; find: string[]; upserts: Row[]; deleted: string[]; calls: Row[]; hangups: string[] };
function fakeClient(over: Partial<Api4comClient> = {}, log: Calls = { me: 0, find: [], upserts: [], deleted: [], calls: [], hangups: [] }) {
  const client: Api4comClient = {
    me: async () => ((log.me += 1), { uuid: 'u-1', name: 'Vendedora Teste', email: 'vendas@exemplo.com' }),
    findIntegrations: async (gateway) => {
      log.find.push(gateway);
      if (gateway === 'sippulse') return [{ id: 1, gateway: 'sippulse', metadata: { username: '1012', domain: 'empresa.api4com.com' } }];
      return log.upserts.length ? [{ id: 5822, gateway }] : [];
    },
    upsertIntegration: async (body) => (log.upserts.push(body), { id: 5822, ...body }),
    deleteIntegration: async (id) => void log.deleted.push(String(id)),
    call: async (input) => (log.calls.push(input), { status: '200', id: 'api4-call-1', message: 'successful request' }),
    hangup: async (id) => void log.hangups.push(id),
    ...over,
  };
  return { client: () => client, log };
}

const ORG = 'org-1';
const USER = 'user-1';
const NOW = new Date('2026-11-03T15:00:00Z');

function connected(extra: Partial<Row> = {}) {
  return fakeDb({
    api4com_user_settings: [{ organization_id: ORG, user_id: USER, api_token: 'tok-abcdef123', extension: '1012', webhook_secret: 'segredo-com-mais-de-16', integration_id: '5822', ...extra }],
    api4com_calls: [],
    deal_events: [],
  });
}

describe('conectar a API4com (por usuário)', () => {
  it('valida o token, descobre o ramal e cadastra o webhook filtrado pelo gateway do CRM', async () => {
    const db = fakeDb({ api4com_user_settings: [] });
    const fake = fakeClient();
    const row = await connectUser(db.admin, { orgId: ORG, userId: USER, token: '  tok-abcdef123  ', webhookUrlFor: (s) => `https://crm.exemplo.com/api/integrations/api4com/webhook/${ORG}/${s}` }, { client: fake.client, now: () => NOW });
    expect(row).toMatchObject({ extension: '1012', domain: 'empresa.api4com.com', api4com_name: 'Vendedora Teste', integration_id: '5822', api_token: 'tok-abcdef123', last_error: null });
    const body = fake.log.upserts[0];
    expect(body.id).toBeUndefined();
    expect(body).toMatchObject({
      gateway: 'nossocrm',
      webhook: true,
      webhookConstraint: { metadata: { gateway: 'nossocrm' } },
      metadata: { webhookVersion: 'v1.8', webhookTypes: ['channel-answer', 'channel-hangup'] },
    });
    expect(String((body.metadata as Row).webhookUrl)).toContain(String(row.webhook_secret));
  });

  it('reconectar reaproveita o segredo e atualiza a integração existente (manda o id)', async () => {
    const db = fakeDb({ api4com_user_settings: [] });
    const fake = fakeClient();
    const url = (s: string) => `https://crm/${s}`;
    const first = await connectUser(db.admin, { orgId: ORG, userId: USER, token: 'tok-abcdef123', webhookUrlFor: url }, { client: fake.client });
    const again = await connectUser(db.admin, { orgId: ORG, userId: USER, token: 'tok-abcdef123', webhookUrlFor: url }, { client: fake.client });
    expect(again.webhook_secret).toBe(first.webhook_secret);
    expect(fake.log.upserts[1].id).toBe(5822);
    expect(db.tables.api4com_user_settings).toHaveLength(1);
  });

  it('usuário sem ramal na API4com não conecta', async () => {
    const db = fakeDb({ api4com_user_settings: [] });
    const fake = fakeClient({ findIntegrations: async () => [] });
    await expect(connectUser(db.admin, { orgId: ORG, userId: USER, token: 'tok-abcdef123', webhookUrlFor: (s) => s }, { client: fake.client })).rejects.toMatchObject({ code: 'NO_EXTENSION' });
    expect(db.tables.api4com_user_settings).toHaveLength(0);
  });

  it('webhook recusado não impede conectar: fica o aviso para tentar de novo', async () => {
    const db = fakeDb({ api4com_user_settings: [] });
    const fake = fakeClient({ upsertIntegration: async () => { throw new Api4comError('INTEGRATION_ALREADY_EXISTS', 422); } });
    const row = await connectUser(db.admin, { orgId: ORG, userId: USER, token: 'tok-abcdef123', webhookUrlFor: (s) => s }, { client: fake.client });
    expect(row.integration_id).toBeNull();
    expect(row.last_error).toContain('webhook não cadastrado');
  });

  it('desconectar apaga o webhook lá e o token aqui', async () => {
    const db = connected();
    const fake = fakeClient();
    await disconnectUser(db.admin, { orgId: ORG, userId: USER }, { client: fake.client });
    expect(fake.log.deleted).toEqual(['5822']);
    expect(db.tables.api4com_user_settings).toHaveLength(0);
  });
});

describe('ligar pelo CRM', () => {
  it('grava a ligação, chama o ramal da pessoa com o id da linha no metadata e guarda o id da API4com', async () => {
    const db = connected();
    const fake = fakeClient();
    const call = await startCall(db.admin, { orgId: ORG, userId: USER, dealId: 'deal-1', contactId: 'c-1', phone: '(11) 98765-4321' }, { client: fake.client, now: () => NOW });
    expect(fake.log.calls[0]).toEqual({ extension: '1012', called: '+5511987654321', metadata: { gateway: 'nossocrm', org: ORG, call: call.id } });
    expect(call).toMatchObject({ status: 'ringing', call_id: 'api4-call-1', called: '+5511987654321', deal_id: 'deal-1', user_id: USER });
  });

  it('webhook que chega antes da resposta não volta o estado para "chamando"', async () => {
    const db = connected();
    const fake = fakeClient({
      call: async (input) => {
        const rowId = String((input.metadata as Row).call);
        await handleApi4comWebhook(db.admin, ORG, { eventType: 'channel-answer', id: 'api4-call-1', metadata: { gateway: 'nossocrm', call: rowId } }, { now: () => NOW });
        return { id: 'api4-call-1' };
      },
    });
    const call = await startCall(db.admin, { orgId: ORG, userId: USER, phone: '+5511987654321' }, { client: fake.client, now: () => NOW });
    expect(call.status).toBe('answered');
  });

  it('sem conexão, sem ramal ou com telefone inválido: nada é discado', async () => {
    const fake = fakeClient();
    await expect(startCall(fakeDb({ api4com_user_settings: [] }).admin, { orgId: ORG, userId: USER, phone: '+5511987654321' }, { client: fake.client })).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await expect(startCall(connected({ extension: null }).admin, { orgId: ORG, userId: USER, phone: '+5511987654321' }, { client: fake.client })).rejects.toMatchObject({ code: 'NO_EXTENSION' });
    await expect(startCall(connected().admin, { orgId: ORG, userId: USER, phone: 'abc' }, { client: fake.client })).rejects.toMatchObject({ code: 'INVALID_PHONE' });
    expect(fake.log.calls).toHaveLength(0);
  });

  it('Webphone fechado (424): a ligação fica como falha com a explicação em português', async () => {
    const db = connected();
    const fake = fakeClient({ call: async () => { throw new Api4comError('channel unavailable', 424); } });
    await expect(startCall(db.admin, { orgId: ORG, userId: USER, phone: '+5511987654321' }, { client: fake.client, now: () => NOW })).rejects.toThrow('Webphone');
    expect(db.tables.api4com_calls[0]).toMatchObject({ status: 'failed', result: 'failed' });
    expect(String(db.tables.api4com_calls[0].error)).toContain('Webphone');
  });
});

describe('retorno da API4com (webhook)', () => {
  async function dialed() {
    const db = connected();
    const call = await startCall(db.admin, { orgId: ORG, userId: USER, dealId: 'deal-1', phone: '+5511987654321' }, { client: fakeClient().client, now: () => NOW });
    return { db, call };
  }

  it('atendida e encerrada: guarda duração e gravação e registra no histórico do lead, em nome de quem ligou', async () => {
    const { db, call } = await dialed();
    const meta = { gateway: 'nossocrm', org: ORG, call: call.id };
    expect(await handleApi4comWebhook(db.admin, ORG, { eventType: 'channel-answer', id: 'api4-call-1', metadata: meta }, { now: () => NOW })).toEqual({ action: 'answered' });
    const out = await handleApi4comWebhook(
      db.admin,
      ORG,
      { eventType: 'channel-hangup', id: 'api4-call-1', duration: 269, hangupCause: 'NORMAL_CLEARING', hangupCauseCode: '16', recordUrl: 'https://listener.api4com.com/files/listen/x.mp3', metadata: meta },
      { now: () => new Date(NOW.getTime() + 280_000) }
    );
    expect(out).toEqual({ action: 'ended:answered' });
    expect(db.tables.api4com_calls[0]).toMatchObject({ status: 'ended', result: 'answered', duration: 269, hangup_cause: 'NORMAL_CLEARING', record_url: 'https://listener.api4com.com/files/listen/x.mp3' });
    expect(db.tables.deal_events).toHaveLength(1);
    expect(db.tables.deal_events[0]).toMatchObject({ deal_id: 'deal-1', kind: 'call', new_value: 'answered', actor_kind: 'user', actor_id: USER, detail: { provider: 'api4com', duration: 269, result: 'answered' } });
  });

  it('aviso repetido não duplica o histórico; não atendida não guarda gravação', async () => {
    const { db, call } = await dialed();
    const hangup = { eventType: 'channel-hangup', id: 'api4-call-1', duration: 0, hangupCause: 'NORMAL_CLEARING', recordUrl: 'https://listener/x.mp3', metadata: { call: call.id } };
    expect((await handleApi4comWebhook(db.admin, ORG, hangup)).action).toBe('ended:no_answer');
    expect((await handleApi4comWebhook(db.admin, ORG, hangup)).action).toBe('ignored:duplicate');
    expect(db.tables.deal_events).toHaveLength(1);
    expect((db.tables.deal_events[0].detail as Row).record_url).toBeNull();
  });

  it('acha a ligação pelo id da API4com quando o metadata não vem; ligação desconhecida é ignorada', async () => {
    const { db } = await dialed();
    expect((await handleApi4comWebhook(db.admin, ORG, { eventType: 'channel-hangup', id: 'api4-call-1', duration: 12, hangupCause: 'NORMAL_CLEARING' })).action).toBe('ended:answered');
    expect((await handleApi4comWebhook(db.admin, ORG, { eventType: 'channel-hangup', id: 'outra' })).action).toBe('ignored:unknown-call');
  });
});

describe('regras puras', () => {
  it('causa de desligamento vira o resultado mostrado', () => {
    expect(resultFor('NORMAL_CLEARING', 30)).toBe('answered');
    expect(resultFor('NORMAL_CLEARING', 0)).toBe('no_answer');
    expect(resultFor('NO_ANSWER', 0)).toBe('no_answer');
    expect(resultFor('USER_BUSY', 0)).toBe('busy');
    expect(resultFor('NUMBER_CHANGED', 0)).toBe('voicemail');
    expect(resultFor('UNALLOCATED_NUMBER', 0)).toBe('invalid');
    expect(resultFor('ORIGINATOR_CANCEL', 0)).toBe('cancelled');
  });
  it('telefone, duração, dedupe e mensagens de erro', () => {
    expect(normalizeCalled('(11) 98765-4321')).toBe('+5511987654321');
    expect(normalizeCalled('')).toBeNull();
    expect(formatDuration(269)).toBe('4 min 29 s');
    expect(formatDuration(35)).toBe('35 s');
    expect(webhookDedupeKey({ id: 'a', eventType: 'channel-hangup' })).toBe('a:channel-hangup');
    expect(friendlyCallError(new Api4comError('x', 401))).toContain('token');
    expect(friendlyCallError(new Api4comError('x', 0, 'TIMEOUT'))).toContain('pode ter saído');
  });
});
