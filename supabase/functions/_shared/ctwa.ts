type Fields = Record<string, unknown>;
const object = (value: unknown): Fields =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};
const field = (value: unknown, limit = 512) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) || null : null;

export function metaCtwa(message: unknown) {
  const ref = object(object(message).referral);
  return referral(ref.source_type, ref.source_id, ref.ctwa_clid, ref.headline, ref.source_url, ref);
}

const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
function campaignParameters(url: URL | null, ...records: Fields[]) {
  const result: Record<string, string> = {};
  for (const key of utmKeys) {
    const suffix = key.slice(4);
    const camel = 'utm' + suffix[0].toUpperCase() + suffix.slice(1);
    const value = records.flatMap(record => [record[key], record[camel]])
      .concat(url?.searchParams.getAll(key) ?? []).map(value => field(value)).find(Boolean);
    if (value) result[key] = value;
  }
  return result;
}

function referral(kind: unknown, id: unknown, click: unknown, title: unknown, url: unknown, ...metadata: Fields[]) {
  const source = field(kind)?.toLowerCase();
  const adId = field(id);
  const clickId = field(click);
  const rawUrl = typeof url === 'string' ? url.trim() : '';
  const parsed = /^https?:\/\//i.test(rawUrl) && URL.canParse(rawUrl) ? new URL(rawUrl) : null;
  const validUrl = parsed ? field(rawUrl, 2048) : null;
  if (source && source !== 'ad') return null;
  if (!clickId && !(source === 'ad' && (adId || validUrl))) return null;
  const utms = campaignParameters(parsed, ...metadata);
  return { ad_id: adId, click_id: clickId, headline: field(title), source_url: validUrl,
    ...(Object.keys(utms).length ? { utms } : {}) };
}

// Look only at the delivered message's own context (never the content of a quote).
export function evolutionCtwa(record: unknown) {
  const root = object(record);
  const contexts = [object(root.contextInfo)];
  let msg = object(root.message);
  for (let depth = 0; depth < 6; depth++) {
    for (const [key, value] of Object.entries(msg)) {
      if (key.endsWith('Message')) contexts.push(object(object(value).contextInfo));
    }
    const wrapped = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage']
      .map(key => object(msg[key]).message).find(Boolean);
    if (!wrapped) break;
    msg = object(wrapped);
  }
  for (const context of contexts) {
    if (context.isForwarded === true || Number(context.forwardingScore) > 0) continue;
    const ad = object(context.externalAdReply);
    const result = referral(ad.sourceType, ad.sourceId, ad.ctwaClid, ad.title, ad.sourceUrl, object(context.utm), ad);
    if (result) return result;
  }
  return null;
}

interface ReferralContext {
  organizationId: string;
  connectionId: string;
  conversationId: string;
  messageId: string;
  timestamp: string;
}

// Keep processing the message (and the rest of its batch) on transient storage
// errors; the webhook can request redelivery after normal chat ingestion.
export async function recordCtwa(
  client: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> },
  context: ReferralContext,
  provider: 'meta' | 'evolution',
  ref: ReturnType<typeof metaCtwa>,
): Promise<boolean> {
  if (!ref) return true;
  try {
    const { error } = await client.rpc('record_wa_ctwa', {
      p_org: context.organizationId, p_connection: context.connectionId, p_conv: context.conversationId,
      p_message: context.messageId, p_time: context.timestamp, p_provider: provider, p_ref: ref,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch {
    console.error('[wa-ctwa] Falha ao registrar referência do anúncio', provider);
    return false;
  }
}
