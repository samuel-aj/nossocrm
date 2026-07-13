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

  async logout(): Promise<void> {
    const { ok, status } = await this.call(
      'DELETE',
      `/instance/logout/${encodeURIComponent(this.instanceName)}`
    );
    // 404 = já estava desconectado; qualquer outro erro é real
    if (!ok && status !== 404) throw new Error(`Evolution respondeu ${status} no logout`);
  }

  async setWebhook(url: string): Promise<void> {
    // v2: corpo aninhado em "webhook". webhookByEvents=false => um único endpoint.
    await this.call('POST', `/webhook/set/${encodeURIComponent(this.instanceName)}`, {
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhookBase64: false,
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
    const key = (data.key as { remoteJid?: string; fromMe?: boolean; id?: string }) ?? {};
    const remoteJid = key.remoteJid ?? '';
    // ignora grupos/broadcast por enquanto
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) {
      return { kind: 'ignored', reason: 'grupo/broadcast' };
    }
    const msg = (data.message as Record<string, unknown>) ?? {};
    const { text, mediaType, mediaMime } = extractContent(msg);

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

/** Extrai texto/mídia das várias formas de message da Evolution/Baileys. */
function extractContent(msg: Record<string, unknown>): {
  text?: string;
  mediaType?: string;
  mediaMime?: string;
} {
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
  return {};
}
