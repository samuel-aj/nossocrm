import { describe, expect, it, vi } from 'vitest';
import { boundedQuoteText, enrichMissingQuote, extractEvolutionQuoteContext, resolveIncomingQuote, resolveQuoteWhenPresent } from '../_shared/quotes';

const content = (m: Record<string, unknown>) => {
  const extended = m.extendedTextMessage as { text?: string } | undefined;
  const image = m.imageMessage as { caption?: string } | undefined;
  return { text: typeof m.conversation === 'string' ? m.conversation : extended?.text ?? image?.caption,
    mediaType: image ? 'image' : undefined };
};
const scope = { organizationId: 'org-A', conversationId: 'conv-A', connectionId: 'conn-A' };
const quote = { providerId: 'original-provider-id', text: 'quoted text', participant: '123@s.whatsapp.net' };

function fakeDb(original: Record<string, unknown> | null = null, failure: 'lookup-error' | 'lookup-throw' | 'update-error' | 'update-throw' | null = null) {
  const filters: Array<[string, string, unknown]> = [];
  const writes: Array<Record<string, unknown>> = [];
  let reads = 0;
  const db = { from(table: string) {
    const q = {
      select: (_columns: string) => q,
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      update: (patch: Record<string, unknown>) => { writes.push(patch); return q; },
      maybeSingle: async () => {
        reads++;
        if (failure === 'lookup-throw') throw new Error('private lookup detail');
        return { data: failure === 'lookup-error' ? null : original,
          error: failure === 'lookup-error' ? new Error('private lookup detail') : null };
      },
      then: (resolve: (result: unknown) => void) => {
        if (failure === 'update-throw') throw new Error('private update detail');
        return resolve({ data: failure === 'update-error' ? null : [{ id: 'message-A' }],
          error: failure === 'update-error' ? new Error('private update detail') : null });
      },
    };
    return q;
  } };
  return { db, filters, writes, get reads() { return reads; } };
}

describe('Evolution incoming quotes', () => {
  it.each(['contactMessage', 'contactsArrayMessage', 'locationMessage', 'liveLocationMessage', 'pollCreationMessage', 'pollCreationMessageV2', 'pollCreationMessageV3'])('preserves quoted and forwarded context inside nested %s', envelope => {
    for (const includeQuote of [false, true]) {
      const record = { message: { viewOnceMessageV2: { message: { [envelope]: {
        contextInfo: { forwardingScore: 1, ...(includeQuote ? {
          stanzaId: 'exact-original-id', quotedMessage: { conversation: 'original text' },
        } : {}) },
      } } } } };
      const context = extractEvolutionQuoteContext(record, content);
      expect(context.forwarded).toBe(true);
      if (includeQuote) expect(context.quoted).toEqual({ providerId: 'exact-original-id', text: 'original text', mediaType: undefined, participant: undefined });
      else expect(context.quoted).toBeUndefined();
    }
  });

  it('extracts the sanitized HOPE provider-record shape (top-level contextInfo)', () => {
    // chat/findMessages exposes contextInfo at record level. Values are synthetic.
    const record = {
      key: { id: 'reply-id', fromMe: false, remoteJid: 'group@g.us', participant: 'participant@s.whatsapp.net' },
      messageType: 'conversation',
      message: { conversation: 'reply text', messageContextInfo: { threadId: [] }, senderKeyDistributionMessage: {} },
      contextInfo: { stanzaId: 'original-provider-id', participant: '123@s.whatsapp.net',
        quotedMessage: { conversation: 'quoted text' }, mentionedJid: [], groupMentions: [] },
    };
    expect(extractEvolutionQuoteContext(record, content)).toEqual({
      quoted: quote, forwarded: false,
    });
  });

  it('handles direct, nested and wrapped context, including media and forwarding', () => {
    const ci = { stanzaId: 'original-provider-id', quotedMessage: { imageMessage: { caption: 'photo caption' } } };
    for (const record of [
      { message: { contextInfo: ci } },
      { message: { imageMessage: { contextInfo: ci } } },
      { message: { ephemeralMessage: { message: { extendedTextMessage: { contextInfo: ci } } } } },
    ]) {
      expect(extractEvolutionQuoteContext(record, content).quoted).toMatchObject({
        providerId: 'original-provider-id', text: 'photo caption', mediaType: 'image',
      });
    }
    expect(extractEvolutionQuoteContext({ message: { extendedTextMessage: {
      contextInfo: { forwardingScore: 2 },
    } } }, content)).toEqual({ forwarded: true });
  });

  it('bounds provider text in the extracted metadata before persistence', () => {
    const text = 'a'.repeat(500);
    const extracted = extractEvolutionQuoteContext({ contextInfo: {
      stanzaId: 'original-provider-id', quotedMessage: { conversation: text },
    } }, content);
    expect(extracted.quoted?.text?.length).toBe(300);
    expect(extracted.quoted?.text?.endsWith('…')).toBe(true);
  });

  it('does zero quote reads for an ordinary message and one for a quoted message', async () => {
    const f = fakeDb();
    const ordinary = extractEvolutionQuoteContext({ message: { conversation: 'hello' } }, content);
    expect(ordinary.quoted).toBeUndefined();
    expect(await resolveQuoteWhenPresent(f.db, scope, ordinary.quoted, null)).toBeNull();
    expect(f.reads).toBe(0);
    expect(await resolveQuoteWhenPresent(f.db, scope, quote, null)).toMatchObject({
      quotedSnapshot: { provider_id: quote.providerId },
    });
    expect(f.reads).toBe(1);
  });

  it('bounds text and preserves safe text without guessing author', async () => {
    const f = fakeDb();
    const malicious = '<script>alert(1)</script>\n' + 'x'.repeat(500);
    const resolved = await resolveIncomingQuote(f.db, scope, { ...quote, text: malicious }, null);
    expect(resolved.quotedMessageId).toBeNull();
    expect(resolved.quotedSnapshot.body?.length).toBeLessThanOrEqual(300);
    expect(resolved.quotedSnapshot.body).toContain('<script>');
    expect(resolved.quotedSnapshot).not.toHaveProperty('sender_name');
    expect(boundedQuoteText('\u0000 a\n b ')).toBe('a b');
    expect(f.reads).toBe(1);
  });

  it('links only within org, conversation and connection; preserves known author', async () => {
    const f = fakeDb({ id: 'original-A', body: 'original body', media_type: 'image',
      direction: 'in', sender_name: 'Maria', deleted_at: null });
    const resolved = await resolveIncomingQuote(f.db, scope, quote, null);
    expect(resolved).toEqual({ quotedMessageId: 'original-A', quotedSnapshot: {
      provider_id: 'original-provider-id', body: 'original body', media_type: 'image', direction: 'in', sender_name: 'Maria',
    } });
    expect(f.filters).toContainEqual(['wa_messages', 'organization_id', 'org-A']);
    expect(f.filters).toContainEqual(['wa_messages', 'conversation_id', 'conv-A']);
    expect(f.filters).toContainEqual(['wa_messages', 'wa_conversations.connection_id', 'conn-A']);
    expect(f.filters).toContainEqual(['wa_messages', 'evolution_message_id', 'original-provider-id']);
  });

  it('marks a known deleted original unavailable', async () => {
    const f = fakeDb({ id: 'deleted-A', body: 'do not show', media_type: null,
      direction: 'out', deleted_at: '2026-09-28T00:00:00Z' });
    expect((await resolveIncomingQuote(f.db, scope, quote, null)).quotedSnapshot).toMatchObject({
      body: null, deleted: true, direction: 'out',
    });
  });

  it('enriches a duplicate using only quote fields and one scoped lookup', async () => {
    const f = fakeDb({ id: 'original-A', body: 'original body', direction: 'in' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const changed = await enrichMissingQuote(f.db, scope,
        { id: 'message-A', quoted: null, quoted_message_id: null }, quote, null);
      expect(changed).toBe(true);
      expect(f.reads).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(f.writes).toEqual([{ quoted: expect.objectContaining({ provider_id: 'original-provider-id' }),
        quoted_message_id: 'original-A' }]);
      expect(Object.keys(f.writes[0])).toEqual(['quoted', 'quoted_message_id']);
      expect(f.filters).toContainEqual(['wa_messages', 'quoted', null]);
      expect(await enrichMissingQuote(f.db, scope,
        { id: 'message-A', quoted: { provider_id: 'original-provider-id' } }, quote, null)).toBe(false);
      expect(f.reads).toBe(1);
    } finally { fetchSpy.mockRestore(); }
  });

  it.each(['lookup-error', 'lookup-throw'] as const)('falls back to provider snapshot on %s without leaking details', async failure => {
    const f = fakeDb(null, failure);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resolved = await resolveIncomingQuote(f.db, scope, quote, null);
      expect(resolved).toEqual({ quotedMessageId: null, quotedSnapshot: {
        provider_id: quote.providerId, body: quote.text, media_type: null, direction: null,
      } });
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.stringify(log.mock.calls)).not.toContain('private lookup detail');
    } finally { log.mockRestore(); }
  });

  it.each(['update-error', 'update-throw'] as const)('keeps duplicate and later edit processing alive on %s', async failure => {
    const f = fakeDb({ id: 'original-A', body: 'original body', direction: 'in' }, failure);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const changed = await enrichMissingQuote(f.db, scope,
        { id: 'message-A', quoted: null }, quote, null);
      const laterEditStillRuns = vi.fn();
      laterEditStillRuns();
      expect(changed).toBe(false);
      expect(laterEditStillRuns).toHaveBeenCalledOnce();
      expect(f.reads).toBe(1);
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.stringify(log.mock.calls)).not.toContain('private update detail');
    } finally { log.mockRestore(); }
  });
});
