import { describe, expect, it, vi } from 'vitest';
import { boundedQuoteText, enrichMissingQuote, extractEvolutionQuoteContext, resolveIncomingQuote } from '../_shared/quotes';

const content = (m: Record<string, unknown>) => {
  const extended = m.extendedTextMessage as { text?: string } | undefined;
  const image = m.imageMessage as { caption?: string } | undefined;
  return { text: typeof m.conversation === 'string' ? m.conversation : extended?.text ?? image?.caption,
    mediaType: image ? 'image' : undefined };
};
const scope = { organizationId: 'org-A', conversationId: 'conv-A', connectionId: 'conn-A' };
const quote = { providerId: 'original-provider-id', text: 'quoted text', participant: '123@s.whatsapp.net' };

function fakeDb(original: Record<string, unknown> | null = null) {
  const filters: Array<[string, string, unknown]> = [];
  const writes: Array<Record<string, unknown>> = [];
  let reads = 0;
  const db = { from(table: string) {
    const q = {
      select: (_columns: string) => q,
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      update: (patch: Record<string, unknown>) => { writes.push(patch); return q; },
      maybeSingle: async () => { reads++; return { data: original, error: null }; },
      then: (resolve: (result: unknown) => void) => resolve({ data: [{ id: 'message-A' }], error: null }),
    };
    return q;
  } };
  return { db, filters, writes, get reads() { return reads; } };
}

describe('Evolution incoming quotes', () => {
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
});
