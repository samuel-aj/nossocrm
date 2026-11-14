import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationContext } from './context';
import type { AgentMediaRow } from './types';
import { deliveredMediaNames, finishMediaDelivery, mediaDeliveryKey, reserveMediaDelivery, simulatedMediaNames } from './mediaDelivery';
import { sendAgentMedia } from './media';

const h = vi.hoisted(() => ({ send: vi.fn(), record: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/whatsapp', () => ({ getProvider: () => ({ sendMedia: h.send }) }));
vi.mock('@/lib/whatsapp/service', () => ({ recordOutboundMessage: h.record, replicateOutboundToSiblings: async () => {} }));

type Row = Record<string, unknown>;
function fixture() {
  const tables: Record<string, Row[]> = { wa_agent_media_deliveries: [], wa_messages: [] };
  const db = {
    from(table: string) {
      let rows = tables[table] ??= [];
      let patch: Row | undefined;
      let single = false;
      const query = {
        select: () => query,
        eq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return query; },
        in: (k: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[k])); return query; },
        maybeSingle: () => { single = true; return query; },
        insert: async (row: Row) => {
          if (tables[table].some(r => ['organization_id', 'conversation_id', 'media_key'].every(k => r[k] === row[k]))) return { error: { code: '23505' } };
          tables[table].push({ ...row }); return { error: null };
        },
        update: (p: Row) => { patch = p; return query; },
        then: (resolve: (value: unknown) => unknown) => {
          if (patch) rows.forEach(r => Object.assign(r, patch));
          return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null }));
        },
      };
      return query;
    },
    storage: { from: () => ({ exists: async () => ({ data: true }), createSignedUrl: async () => ({ data: { signedUrl: 'https://media.invalid/test' } }) }) },
  } as unknown as SupabaseClient;
  const media = { id: 'media', organization_id: 'org', agent_id: 'agent', name: 'boas_vindas', storage_path: 'org/source/video.mp4', outbox_path: 'org/out/video.mp4', kind: 'video', mime: 'video/mp4' } as AgentMediaRow;
  const ctx = { conversation: { id: 'conversation', organization_id: 'org', wa_phone: '+5500000000000', ai_state: {} }, connection: { status: 'connected', phone_number: '+5500000000001' } } as ConversationContext;
  const input = { organizationId: 'org', agent: { id: 'agent', name: 'Teste' }, ctx, media };
  return { db, tables, media, input, scope: { organizationId: 'org', conversationId: 'conversation' } };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.send.mockReset().mockResolvedValue({ ok: true, providerMessageId: 'provider' });
  h.record.mockReset().mockResolvedValue({ id: 'message', body: '' });
  h.fetch.mockImplementation(() => { throw new Error('External network is forbidden'); });
  vi.stubGlobal('fetch', h.fetch);
});

describe('once-per-conversation media receipts', () => {
  it('reserves once atomically, with independent organizations/conversations/assets', async () => {
    const f = fixture();
    const claims = await Promise.all([reserveMediaDelivery(f.db, f.scope, f.media), reserveMediaDelivery(f.db, f.scope, f.media)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await reserveMediaDelivery(f.db, { ...f.scope, conversationId: 'another' }, f.media)).not.toBeNull();
    expect(await reserveMediaDelivery(f.db, { ...f.scope, organizationId: 'another' }, f.media)).not.toBeNull();
    expect(await reserveMediaDelivery(f.db, f.scope, { ...f.media, storage_path: 'org/source/second.mp4' })).not.toBeNull();
    expect(mediaDeliveryKey(f.media)).toBe(mediaDeliveryKey({ ...f.media, name: 'renamed' }));
  });

  it('only retries an explicitly failed attempt and does not overwrite a later owner', async () => {
    const f = fixture();
    const first = (await reserveMediaDelivery(f.db, f.scope, f.media))!;
    expect(await reserveMediaDelivery(f.db, f.scope, f.media)).toBeNull();
    await finishMediaDelivery(f.db, first, 'failed');
    const second = (await reserveMediaDelivery(f.db, f.scope, f.media))!;
    expect(second.attempt).not.toBe(first.attempt);
    await finishMediaDelivery(f.db, first, 'failed');
    expect(f.tables.wa_agent_media_deliveries[0].state).toBe('sending');
    await finishMediaDelivery(f.db, second, 'sent');
    expect(await reserveMediaDelivery(f.db, f.scope, f.media)).toBeNull();
  });

  it('honors successful legacy messages and excludes inbound, failed and other conversations', async () => {
    const f = fixture();
    const row = { organization_id: 'org', conversation_id: 'conversation', media_url: f.media.outbox_path, direction: 'out', source: 'agent', status: 'delivered' };
    f.tables.wa_messages.push({ ...row, status: 'failed' }, { ...row, direction: 'in' }, { ...row, conversation_id: 'other' });
    expect(await deliveredMediaNames(f.db, f.scope, [f.media])).toEqual(new Set());
    f.tables.wa_messages.push(row);
    expect(await deliveredMediaNames(f.db, f.scope, [f.media])).toEqual(new Set(['boas_vindas']));
    expect(await sendAgentMedia(f.db, f.input)).toMatchObject({ ok: true, skipped: true });
    expect(h.send).not.toHaveBeenCalled();
  });

  it('sends one file once even after ai_state reset and suppresses repeated caption', async () => {
    const f = fixture(); const caption = vi.fn();
    expect(await sendAgentMedia(f.db, { ...f.input, beforeDispatch: caption })).toMatchObject({ ok: true, messageId: 'message' });
    f.input.ctx.conversation.ai_state = {};
    expect(await sendAgentMedia(f.db, { ...f.input, beforeDispatch: caption })).toMatchObject({ ok: true, skipped: true });
    expect(h.send).toHaveBeenCalledTimes(1); expect(caption).toHaveBeenCalledTimes(1); expect(h.fetch).not.toHaveBeenCalled();
  });

  it('allows retry after an explicit provider rejection', async () => {
    const f = fixture();
    h.send.mockResolvedValueOnce({ ok: false, error: 'Mídia inválida', raw: { error: { code: 400 } } });
    expect(await sendAgentMedia(f.db, f.input)).toMatchObject({ ok: false });
    expect(f.tables.wa_agent_media_deliveries[0].state).toBe('failed');
    expect(await sendAgentMedia(f.db, f.input)).toMatchObject({ ok: true });
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('does not retry a timeout with uncertain provider outcome', async () => {
    const f = fixture(); h.send.mockRejectedValueOnce(new Error('network timeout'));
    expect(await sendAgentMedia(f.db, f.input)).toMatchObject({ ok: false });
    expect(f.tables.wa_agent_media_deliveries[0].state).toBe('sending');
    expect(await sendAgentMedia(f.db, f.input)).toMatchObject({ ok: true, skipped: true });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('does not repeat an acknowledged send if saving the chat message failed', async () => {
    const f = fixture(); h.record.mockRejectedValueOnce(new Error('DB unavailable'));
    expect(await sendAgentMedia(f.db, f.input)).toMatchObject({ ok: true, messageId: null });
    expect(await sendAgentMedia(f.db, f.input)).toMatchObject({ ok: true, skipped: true });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('rejects media from another organization before reserving or sending', async () => {
    const f = fixture();
    expect(await sendAgentMedia(f.db, { ...f.input, media: { ...f.media, organization_id: 'another' } })).toMatchObject({ ok: false });
    expect(f.tables.wa_agent_media_deliveries).toHaveLength(0); expect(h.send).not.toHaveBeenCalled();
  });

  it('simulated receipts survive turns and ignore user-authored claims', () => {
    expect(simulatedMediaNames([{ role: 'assistant', media: ['Boas_vindas', 'PROPOSTA'] }, { role: 'user', media: ['tutorial_assinatura'] }]))
      .toEqual(new Set(['boas_vindas', 'proposta']));
    expect(simulatedMediaNames([])).toEqual(new Set());
  });
});
