import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentMediaRow } from './types';
import { normalizeAgentRow } from './context';
import { reserveTestMedia, settleTestMedia, testDeliveredMediaNames, type TestMediaScope } from './testMediaDelivery';
import { testAgentReply } from './test';

const h = vi.hoisted(() => ({ generate: vi.fn(), log: vi.fn(), media: [] as AgentMediaRow[] }));
vi.mock('server-only', () => ({}));
vi.mock('./engine', () => ({ generateAgentReply: h.generate, MAX_HELPER_CALLS_PER_RUN: 3, MAX_KNOWLEDGE_CALLS_PER_RUN: 3, NO_REPLY_TOKEN: '[SILENCIO]' }));
vi.mock('./model', () => ({ resolveAgentModel: async () => ({ model: {}, modelId: 'fake' }) }));
vi.mock('./resources', () => ({ loadAgentResources: async () => ({ media: h.media, documents: [], helpers: [] }) }));
vi.mock('./runs', () => ({ logRun: h.log }));
vi.mock('@/lib/ai-usage/budget', () => ({ createUsageContext: async () => ({ organizationId: 'org', scope: 'test' }) }));

type Row = Record<string, unknown>;
const keyFields = ['organization_id', 'user_id', 'agent_id', 'session_id', 'media_key'];
function fixture() {
  const rows: Row[] = [];
  let failure: string | null = null;
  const db = { from: vi.fn((table: string) => {
    if (table === 'organizations') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Teste' } }) }) }) };
    expect(table).toBe('wa_agent_test_media_deliveries');
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | undefined; let remove = false; let single = false;
    const query = {
      select: () => query,
      eq: (k: string, v: unknown) => { filters.push(row => row[k] === v); return query; },
      lte: (k: string, v: string) => { filters.push(row => String(row[k]) <= v); return query; },
      update: (value: Row) => { patch = value; return query; },
      delete: () => { remove = true; return query; },
      maybeSingle: () => { single = true; return query; },
      insert: async (row: Row) => {
        if (failure) return { error: { message: failure } };
        if (rows.some(existing => keyFields.every(k => existing[k] === row[k]))) return { error: { code: '23505' } };
        rows.push({ ...row, updated_at: new Date().toISOString() });
        return { error: null };
      },
      then: (resolve: (result: unknown) => unknown) => {
        if (failure) return Promise.resolve(resolve({ data: null, error: { message: failure } }));
        const found = rows.filter(row => filters.every(filter => filter(row)));
        if (patch) found.forEach(row => Object.assign(row, patch));
        if (remove) for (const row of found) rows.splice(rows.indexOf(row), 1);
        return Promise.resolve(resolve({ data: single ? found[0] ?? null : found, error: null }));
      },
    };
    return query;
  }) } as unknown as SupabaseClient;
  const scope: TestMediaScope = { organizationId: 'org', userId: 'user', agentId: 'agent', sessionId: 'session' };
  const media = { id: 'media', name: 'boas_vindas', kind: 'video', storage_path: 'org/media/video.mp4', send_once_per_conversation: true } as AgentMediaRow;
  return { db, rows, scope, media, fail: (message: string | null) => { failure = message; } };
}

beforeEach(() => { vi.clearAllMocks(); h.generate.mockReset(); h.media = []; });

describe('server receipts for simulated media', () => {
  it('reserves once concurrently and isolates user, agent, office, session and asset', async () => {
    const f = fixture();
    expect((await Promise.all([reserveTestMedia(f.db, f.scope, f.media), reserveTestMedia(f.db, f.scope, f.media)])).filter(Boolean)).toHaveLength(1);
    for (const key of ['organizationId', 'userId', 'agentId', 'sessionId'] as const) {
      expect(await reserveTestMedia(f.db, { ...f.scope, [key]: 'other' }, f.media)).not.toBeNull();
    }
    expect(await reserveTestMedia(f.db, f.scope, { ...f.media, name: 'renamed' })).toBeNull();
    expect(await reserveTestMedia(f.db, f.scope, { ...f.media, storage_path: 'org/new.mp4' })).not.toBeNull();
  });

  it('allows repeatable media after 60s, but pending and once-only media do not expire', async () => {
    const f = fixture(); const media = { ...f.media, send_once_per_conversation: false };
    const receipt = (await reserveTestMedia(f.db, f.scope, media))!;
    f.rows[0].updated_at = new Date(Date.now() - 120_000).toISOString();
    expect(await reserveTestMedia(f.db, f.scope, media)).toBeNull();
    await settleTestMedia(f.db, [receipt], true);
    expect(await reserveTestMedia(f.db, f.scope, media)).toBeNull();
    expect(await testDeliveredMediaNames(f.db, f.scope, [media])).toEqual(new Set(['boas_vindas']));
    f.rows[0].updated_at = new Date(Date.now() - 61_000).toISOString();
    expect(await testDeliveredMediaNames(f.db, f.scope, [media])).toEqual(new Set());
    expect(await reserveTestMedia(f.db, f.scope, f.media)).toBeNull();
    const retries = await Promise.all([reserveTestMedia(f.db, f.scope, media), reserveTestMedia(f.db, f.scope, media)]);
    expect(retries.filter(Boolean)).toHaveLength(1);
    await settleTestMedia(f.db, [receipt], false);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].attempt_id).toBe(retries.find(Boolean)!.attempt);
  });

  it('fails closed when the ledger cannot be consulted or reserved', async () => {
    const f = fixture(); f.fail('DB unavailable');
    await expect(testDeliveredMediaNames(f.db, f.scope, [f.media])).rejects.toThrow('DB unavailable');
    await expect(reserveTestMedia(f.db, f.scope, f.media)).rejects.toThrow('DB unavailable');
    expect(f.rows).toHaveLength(0);
  });

  it('preserves an earlier delivery when a repeat attempt fails and once-only is enabled later', async () => {
    const f = fixture(); const repeatable = { ...f.media, send_once_per_conversation: false };
    const first = (await reserveTestMedia(f.db, f.scope, repeatable))!;
    await settleTestMedia(f.db, [first], true);
    const previous = new Date(Date.now() - 61_000).toISOString();
    f.rows[0].updated_at = previous;
    const retry = (await reserveTestMedia(f.db, f.scope, repeatable))!;
    expect(retry.previousDeliveredAt).toBe(previous);
    await settleTestMedia(f.db, [retry], false);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ state: 'delivered', updated_at: previous });
    expect(await testDeliveredMediaNames(f.db, f.scope, [f.media])).toEqual(new Set(['boas_vindas']));
    expect(await reserveTestMedia(f.db, f.scope, f.media)).toBeNull();
    const third = (await reserveTestMedia(f.db, f.scope, repeatable))!;
    await settleTestMedia(f.db, [retry], false);
    expect(f.rows[0]).toMatchObject({ state: 'pending', attempt_id: third.attempt });
  });

  it('continues a simulation without client media receipts or history', async () => {
    const f = fixture(); h.media = [f.media];
    const agent = normalizeAgentRow({ id: 'agent', organization_id: 'org' });
    const outputs: unknown[] = [];
    h.generate.mockImplementation(async ({ runtime }) => {
      const output = await runtime.sendMedia(f.media); outputs.push(output);
      return { text: 'Olá', segments: [{ kind: 'text', text: 'Olá' }, { kind: 'media', name: 'boas_vindas' }],
        toolCalls: [{ tool: 'enviar_midia', output }], usage: null, outputSafety: { status: 'passed' } };
    });
    const input = { organizationId: 'org', agent, messages: [], session: { id: 'session', userId: 'user' } };
    expect((await testAgentReply(f.db, input)).media).toEqual(['boas_vindas']);
    const second = await testAgentReply(f.db, input);
    expect(second.media).toEqual([]);
    expect(second.segments).toEqual([{ kind: 'text', text: 'Olá' }]);
    expect(outputs).toMatchObject([{ ok: true }, { ok: false }]);
    expect((await testAgentReply(f.db, { ...input, session: { ...input.session, id: 'independent' } })).media).toEqual(['boas_vindas']);
    expect(h.log).toHaveBeenCalledWith(f.db, expect.objectContaining({ events: expect.arrayContaining([expect.objectContaining({ type: 'test_session', session_id: 'session' })]) }));
  });

  it.each(['model', 'safety'])('releases only this request reservations after %s failure', async failure => {
    const f = fixture(); h.media = [f.media];
    const agent = normalizeAgentRow({ id: 'agent', organization_id: 'org' });
    const other = { ...f.media, storage_path: 'other.mp4', name: 'proposta' };
    await reserveTestMedia(f.db, f.scope, other);
    h.generate.mockImplementation(async ({ runtime }) => {
      await runtime.sendMedia(f.media);
      if (failure === 'model') throw new Error('Model failed');
      return { text: '', segments: [], toolCalls: [], usage: null, outputSafety: { status: 'blocked' } };
    });
    const input = { organizationId: 'org', agent, messages: [], session: { id: 'session', userId: 'user' } };
    await expect(testAgentReply(f.db, input)).rejects.toThrow();
    expect(f.rows).toHaveLength(1);
    expect(await reserveTestMedia(f.db, f.scope, f.media)).not.toBeNull();
    expect(await reserveTestMedia(f.db, f.scope, other)).toBeNull();
  });

  it('ignores old untimed client receipts for repeatable files while retaining server cooldown', async () => {
    const f = fixture(); f.media.send_once_per_conversation = false; h.media = [f.media];
    const agent = normalizeAgentRow({ id: 'agent', organization_id: 'org' });
    h.generate.mockImplementation(async ({ runtime }) => {
      const output = await runtime.sendMedia(f.media);
      return { text: 'Vídeo', segments: output.ok ? [{ kind: 'media', name: 'boas_vindas' }] : [], toolCalls: [], usage: null, outputSafety: { status: 'passed' } };
    });
    const input = { organizationId: 'org', agent, messages: [{ role: 'assistant' as const, text: 'Vídeo', media: ['boas_vindas'] }], session: { id: 'session', userId: 'user' } };
    expect((await testAgentReply(f.db, input)).media).toEqual(['boas_vindas']);
    expect((await testAgentReply(f.db, input)).media).toEqual([]);
    f.rows[0].updated_at = new Date(Date.now() - 61_000).toISOString();
    expect((await testAgentReply(f.db, input)).media).toEqual(['boas_vindas']);
  });
});
