/**
 * Adapter da Evolution API (v2) — implementa WhatsAppProvider.
 *
 * Endpoints usados (Evolution v2.x):
 *   GET  /instance/connectionState/{instance}   -> { instance: { state: 'open'|'connecting'|'close' } }
 *   GET  /instance/connect/{instance}           -> { base64, code, pairingCode } (QR p/ conectar)
 *   POST /message/sendText/{instance}           body { number, text } -> { key: { id }, ... }
 *   POST /webhook/set/{instance}                body { webhook: {...} }
 * Header de auth: `apikey: <token>`.
 *
 * Eventos de webhook tratados: messages.upsert, connection.update, qrcode.updated, messages.update.
 */
import { normalizePhoneE164, toWhatsAppPhone } from '@/lib/phone';
import type {
  WhatsAppProvider,
  ProviderConfig,
  SendTextInput,
  SendMediaInput,
  SendResult,
  QrResult,
  InboundEvent,
  WaConnectionState,
  NormalizedInboundMessage,
} from './types';

/** Converte um JID do WhatsApp ("5511999999999@s.whatsapp.net") em E.164 ("+5511999999999"). */
export function jidToE164(jid?: string | null): string {
  if (!jid) return '';
  const digits = String(jid).split('@')[0].split(':')[0].replace(/[^\d]/g, '');
  if (!digits) return '';
  return normalizePhoneE164(`+${digits}`);
}

function mapState(state?: string): WaConnectionState {
  switch (state) {
    case 'open':
      return 'connected';
    case 'connecting':
      return 'connecting';
    default:
      return 'disconnected'; // 'close' | undefined
  }
}

/** Eventos que pedimos à Evolution ao registrar o webhook (formato UPPER_SNAKE). */
const WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
] as const;

export class EvolutionProvider implements WhatsAppProvider {
  readonly instanceName: string;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: ProviderConfig) {
    // remove barra final e um eventual /manager coladinho na base
    this.baseUrl = config.baseUrl.replace(/\/+$/, '').replace(/\/manager$/, '');
    this.instanceName = config.instanceName;
    this.token = config.token;
  }

  private async call<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<{ ok: boolean; status: number; data: T | null }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.token,
      },
      body: body ? JSON.stringify(body) : undefined,
      // sem cache; chamadas server-side
      cache: 'no-store',
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  async getConnectionState(): Promise<WaConnectionState> {
    const { ok, data } = await this.call<{ instance?: { state?: string }; state?: string }>(
      'GET',
      `/instance/connectionState/${encodeURIComponent(this.instanceName)}`
    );
    if (!ok || !data) return 'disconnected';
    return mapState(data.instance?.state ?? data.state);
  }

  async getQrCode(): Promise<QrResult> {
    const { ok, data } = await this.call<{
      base64?: string;
      code?: string;
      pairingCode?: string;
      instance?: { state?: string };
      state?: string;
    }>('GET', `/instance/connect/${encodeURIComponent(this.instanceName)}`);

    if (!ok || !data) return { state: 'disconnected' };
    // Se já está conectado, a Evolution não devolve QR.
    const state = mapState(data.instance?.state ?? data.state);
    return {
      state: data.base64 ? 'connecting' : state,
      qrBase64: data.base64,
      pairingCode: data.pairingCode ?? data.code,
    };
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const number = toWhatsAppPhone(input.to); // só dígitos, como a Evolution espera
    if (!number) return { ok: false, error: 'Telefone inválido' };

    const { ok, status, data } = await this.call<{
      key?: { id?: string };
      message?: unknown;
      error?: unknown;
      response?: unknown;
    }>('POST', `/message/sendText/${encodeURIComponent(this.instanceName)}`, {
      number,
      text: input.text,
    });

    if (!ok) {
      return { ok: false, error: `Evolution respondeu ${status}`, raw: data };
    }
    return { ok: true, providerMessageId: data?.key?.id, raw: data };
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const number = toWhatsAppPhone(input.to);
    if (!number) return { ok: false, error: 'Telefone inválido' };

    let path: string;
    let body: Record<string, unknown>;
    if (input.kind === 'audio') {
      // Mensagem de VOZ (PTT); encoding=true faz a Evolution converter p/ opus
      path = `/message/sendWhatsAppAudio/${encodeURIComponent(this.instanceName)}`;
      body = { number, audio: input.media, encoding: true };
    } else if (input.kind === 'sticker') {
      path = `/message/sendSticker/${encodeURIComponent(this.instanceName)}`;
      body = { number, sticker: input.media };
    } else {
      path = `/message/sendMedia/${encodeURIComponent(this.instanceName)}`;
      body = {
        number,
        mediatype: input.kind,
        media: input.media,
        ...(input.mimeType ? { mimetype: input.mimeType } : {}),
        ...(input.fileName ? { fileName: input.fileName } : {}),
        ...(input.caption ? { caption: input.caption } : {}),
      };
    }

    const { ok, status, data } = await this.call<{ key?: { id?: string } }>('POST', path, body);
    if (!ok) return { ok: false, error: `Evolution respondeu ${status}`, raw: data };
    return { ok: true, providerMessageId: data?.key?.id, raw: data };
  }

  async logout(): Promise<void> {
    const { ok, status } = await this.call(
      'DELETE',
      `/instance/logout/${encodeURIComponent(this.instanceName)}`
    );
    // 404/400 = instância já desconectada (a v2 devolve 400 nesse caso);
    // qualquer outro erro é real
    if (!ok && status !== 404 && status !== 400) {
      throw new Error(`Evolution respondeu ${status} no logout`);
    }
  }

  async setWebhook(url: string): Promise<void> {
    // v2: corpo aninhado em "webhook". webhookByEvents=false => um único endpoint.
    await this.call('POST', `/webhook/set/${encodeURIComponent(this.instanceName)}`, {
      webhook: {
        enabled: true,
        url,
        // v2 usa byEvents/base64; mantém as grafias antigas por compatibilidade
        byEvents: false,
        webhookByEvents: false,
        // true: mídias chegam com base64 no payload — o webhook sobe pro Storage
        base64: true,
        webhookBase64: true,
        events: WEBHOOK_EVENTS,
      },
    });
  }

  parseWebhook(payload: unknown): InboundEvent {
    const p = (payload ?? {}) as {
      event?: string;
      instance?: string;
      data?: Record<string, unknown> | Array<Record<string, unknown>>;
    };
    const event = (p.event ?? '').toLowerCase().replace(/_/g, '.');
    const data = p.data as Record<string, unknown> | undefined;

    switch (event) {
      case 'messages.upsert':
        return this.parseInboundMessage(data);
      case 'connection.update':
        return { kind: 'connection', state: mapState((data?.state as string) ?? undefined) };
      case 'qrcode.updated': {
        const qr = (data?.qrcode as { base64?: string } | undefined) ?? (data as { base64?: string } | undefined);
        return { kind: 'qrcode', qrBase64: qr?.base64 };
      }
      case 'messages.update':
        return this.parseStatusUpdate(data);
      default:
        return { kind: 'ignored', reason: event || 'sem evento' };
    }
  }

  private parseInboundMessage(data: Record<string, unknown> | undefined): InboundEvent {
    if (!data) return { kind: 'ignored', reason: 'messages.upsert sem data' };
    const key =
      (data.key as { remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean; id?: string }) ?? {};
    // JID de privacidade (@lid): o telefone real vem em remoteJidAlt
    const rawJid = key.remoteJid ?? '';
    const altJid = key.remoteJidAlt ?? (data.remoteJidAlt as string | undefined) ?? '';
    const remoteJid = rawJid.endsWith('@lid') && altJid ? altJid : rawJid;
    // ignora grupos/broadcast (e @lid sem telefone alternativo) por enquanto
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@lid')) {
      return { kind: 'ignored', reason: 'grupo/broadcast/lid' };
    }
    const msg = (data.message as Record<string, unknown>) ?? {};
    const { text, mediaType, mediaMime, skip } = extractContent(msg);
    if (skip) return { kind: 'ignored', reason: 'evento sem bolha (reação/protocolo)' };

    const tsRaw = data.messageTimestamp as number | string | undefined;
    const tsNum = typeof tsRaw === 'string' ? parseInt(tsRaw, 10) : tsRaw;
    const timestamp = tsNum ? new Date(tsNum * 1000).toISOString() : undefined;

    const message: NormalizedInboundMessage = {
      providerMessageId: key.id ?? '',
      fromPhone: jidToE164(remoteJid),
      fromMe: Boolean(key.fromMe),
      pushName: (data.pushName as string) ?? undefined,
      text,
      mediaType,
      mediaMime,
      timestamp,
    };
    if (!message.fromPhone || !message.providerMessageId) {
      return { kind: 'ignored', reason: 'mensagem sem telefone/id' };
    }
    return { kind: 'message', message };
  }

  private parseStatusUpdate(data: Record<string, unknown> | Array<Record<string, unknown>> | undefined): InboundEvent {
    const item = Array.isArray(data) ? data[0] : data;
    if (!item) return { kind: 'ignored', reason: 'status sem data' };
    const key = (item.key as { id?: string }) ?? {};
    const id = key.id ?? (item.keyId as string) ?? '';
    const raw = String((item.status as string) ?? '').toUpperCase();
    const map: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
      SERVER_ACK: 'sent',
      DELIVERY_ACK: 'delivered',
      READ: 'read',
      PLAYED: 'read',
      ERROR: 'failed',
    };
    const status = map[raw];
    if (!id || !status) return { kind: 'ignored', reason: `status ${raw}` };
    return { kind: 'status', providerMessageId: id, status };
  }
}

/**
 * Desembrulha contêineres do WhatsApp: GIFs, mensagens temporárias e "ver uma
 * vez" chegam como { ephemeralMessage|viewOnceMessage*|documentWithCaption-
 * Message|deviceSentMessage: { message: {...} } }.
 */
function unwrapMessage(message: Record<string, unknown>): Record<string, unknown> {
  let msg = message;
  for (let i = 0; i < 3 && msg; i++) {
    const wrapper = (msg.ephemeralMessage ??
      msg.viewOnceMessage ??
      msg.viewOnceMessageV2 ??
      msg.viewOnceMessageV2Extension ??
      msg.documentWithCaptionMessage ??
      msg.deviceSentMessage) as { message?: Record<string, unknown> } | undefined;
    if (wrapper?.message) msg = wrapper.message;
    else break;
  }
  return msg;
}

/** Extrai o telefone de um vCard (waid= ou linha TEL). */
function vcardPhone(vcard?: string): string {
  if (!vcard) return '';
  const wa = vcard.match(/waid=(\d+)/);
  if (wa) return `+${wa[1]}`;
  const tel = vcard.match(/TEL[^:]*:([+\d][\d\s().-]{5,})/i);
  return tel ? tel[1].trim() : '';
}

/** Extrai texto/mídia das várias formas de message da Evolution/Baileys. */
function extractContent(rawMsg: Record<string, unknown>): {
  text?: string;
  mediaType?: string;
  mediaMime?: string;
  /** true = evento sem bolha (reação, protocolo, voto de enquete) */
  skip?: boolean;
} {
  const msg = unwrapMessage(rawMsg);
  if (typeof msg.conversation === 'string') return { text: msg.conversation };
  const ext = msg.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) return { text: ext.text };

  const mediaKinds: Array<[string, string]> = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio'],
    ['documentMessage', 'document'],
    ['stickerMessage', 'sticker'],
  ];
  for (const [field, type] of mediaKinds) {
    const m = msg[field] as { caption?: string; mimetype?: string } | undefined;
    if (m) return { text: m.caption, mediaType: type, mediaMime: m.mimetype };
  }

  // Cartão de contato compartilhado (vCard) — vira texto legível no chat
  const contact = msg.contactMessage as { displayName?: string; vcard?: string } | undefined;
  if (contact) {
    const phone = vcardPhone(contact.vcard);
    return { text: `👤 Contato compartilhado: ${contact.displayName || 'sem nome'}${phone ? `\n${phone}` : ''}` };
  }
  const contacts = msg.contactsArrayMessage as
    | { contacts?: Array<{ displayName?: string; vcard?: string }> }
    | undefined;
  if (contacts?.contacts?.length) {
    const rows = contacts.contacts.map(c => {
      const phone = vcardPhone(c.vcard);
      return `${c.displayName || 'sem nome'}${phone ? ` — ${phone}` : ''}`;
    });
    return { text: `👤 Contatos compartilhados:\n${rows.join('\n')}` };
  }

  // Localização — texto com link do Maps
  const loc = (msg.locationMessage ?? msg.liveLocationMessage) as
    | { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string }
    | undefined;
  if (loc && loc.degreesLatitude !== undefined) {
    const label = loc.name || loc.address || 'Localização';
    return { text: `📍 ${label}\nhttps://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}` };
  }

  // Enquete criada — pergunta + opções como texto
  const poll = (msg.pollCreationMessageV3 ?? msg.pollCreationMessageV2 ?? msg.pollCreationMessage) as
    | { name?: string; options?: Array<{ optionName?: string }> }
    | undefined;
  if (poll?.name) {
    const opts = (poll.options ?? []).map(o => `• ${o.optionName}`).join('\n');
    return { text: `📊 Enquete: ${poll.name}${opts ? `\n${opts}` : ''}` };
  }

  // Eventos de protocolo/reação/voto: não são "mensagens" — sem bolha
  if (msg.reactionMessage || msg.protocolMessage || msg.pollUpdateMessage || msg.senderKeyDistributionMessage) {
    return { skip: true };
  }
  const keys = Object.keys(msg);
  if (keys.length > 0 && keys.every(k => k === 'messageContextInfo')) {
    return { skip: true };
  }
  return {};
}
