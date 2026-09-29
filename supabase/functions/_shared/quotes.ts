/** Pure Evolution reply context normalization plus scoped snapshot persistence. */
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};

export interface IncomingQuote {
  providerId: string;
  text?: string;
  mediaType?: string;
  participant?: string;
}

export interface QuoteContext {
  quoted?: IncomingQuote;
  forwarded: boolean;
}

type Content = (value: Obj) => { text?: string; mediaType?: string };

/** Evolution may put contextInfo on the record itself or inside a message type. */
export function extractEvolutionQuoteContext(record: unknown, content: Content): QuoteContext {
  const queue: Obj[] = [object(record)];
  const seen = new Set<Obj>();
  let forwarded = false;
  for (let i = 0; i < queue.length && i < 32; i++) {
    const node = queue[i];
    if (seen.has(node)) continue;
    seen.add(node);
    const ci = object(node.contextInfo);
    if (Object.keys(ci).length) {
      forwarded ||= ci.isForwarded === true || Number(ci.forwardingScore ?? 0) > 0;
      const providerId = typeof ci.stanzaId === 'string' ? ci.stanzaId.trim() : '';
      if (providerId) {
        const quotedContent = content(object(ci.quotedMessage));
        return {
          quoted: {
            providerId,
            text: quotedContent.text,
            mediaType: quotedContent.mediaType,
            participant: typeof ci.participant === 'string' ? ci.participant : undefined,
          },
          forwarded,
        };
      }
    }
    for (const key of [
      'message', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2',
      'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'deviceSentMessage',
      'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage',
      'documentMessage', 'stickerMessage', 'contactMessage',
    ]) {
      if (node[key] && typeof node[key] === 'object') queue.push(object(node[key]));
    }
  }
  return { forwarded };
}

export function boundedQuoteText(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > 300 ? `${clean.slice(0, 299)}…` : clean;
}

export interface QuoteSnapshot {
  provider_id: string;
  body: string | null;
  media_type: string | null;
  direction: 'in' | 'out' | null;
  sender_name?: string | null;
  deleted?: boolean;
}

export async function resolveIncomingQuote(
  // deno-lint-ignore no-explicit-any
  db: any,
  scope: { organizationId: string; conversationId: string; connectionId: string },
  quote: IncomingQuote,
  fallbackDirection: 'in' | 'out' | null,
): Promise<{ quotedMessageId: string | null; quotedSnapshot: QuoteSnapshot }> {
  const { data: original, error } = await db.from('wa_messages')
    .select('id, body, media_type, direction, sender_name, deleted_at, wa_conversations!inner(connection_id)')
    .eq('organization_id', scope.organizationId)
    .eq('conversation_id', scope.conversationId)
    .eq('wa_conversations.connection_id', scope.connectionId)
    .eq('evolution_message_id', quote.providerId)
    .maybeSingle();
  if (error) throw new Error('Quoted message lookup failed');
  if (original) {
    const deleted = !!original.deleted_at;
    return {
      quotedMessageId: original.id,
      quotedSnapshot: {
        provider_id: quote.providerId,
        body: deleted ? null : boundedQuoteText(original.body ?? quote.text),
        media_type: deleted ? null : original.media_type ?? quote.mediaType ?? null,
        direction: original.direction === 'in' || original.direction === 'out' ? original.direction : null,
        ...(typeof original.sender_name === 'string' && original.sender_name.trim()
          ? { sender_name: original.sender_name.trim().slice(0, 100) } : {}),
        ...(deleted ? { deleted: true } : {}),
      },
    };
  }
  return {
    quotedMessageId: null,
    quotedSnapshot: {
      provider_id: quote.providerId,
      body: boundedQuoteText(quote.text),
      media_type: quote.mediaType ?? null,
      direction: fallbackDirection,
    },
  };
}

/** A duplicate webhook may supply missing context. Touch only quote columns. */
export async function enrichMissingQuote(
  // deno-lint-ignore no-explicit-any
  db: any,
  scope: { organizationId: string; conversationId: string; connectionId: string },
  existing: { id: string; quoted?: unknown; quoted_message_id?: string | null },
  quote: IncomingQuote,
  fallbackDirection: 'in' | 'out' | null,
): Promise<boolean> {
  if (existing.quoted) return false;
  const resolved = await resolveIncomingQuote(db, scope, quote, fallbackDirection);
  const patch: Record<string, unknown> = { quoted: resolved.quotedSnapshot };
  if (!existing.quoted_message_id && resolved.quotedMessageId) patch.quoted_message_id = resolved.quotedMessageId;
  const { data, error } = await db.from('wa_messages').update(patch)
    .eq('id', existing.id)
    .eq('organization_id', scope.organizationId)
    .eq('conversation_id', scope.conversationId)
    .is('quoted', null)
    .select('id');
  if (error) throw new Error('Quoted message enrichment failed');
  return !!data?.length;
}
