/**
 * Adapter da WhatsApp Cloud API da Meta (graph.facebook.com) — DIRETO, sem
 * Evolution. Implementa WhatsAppProvider.
 *
 * Envio:   POST https://graph.facebook.com/vXX/{phone_number_id}/messages
 *          header Authorization: Bearer <token permanente da Meta>
 * Recebimento: NÃO passa por aqui — chega no webhook nativo da Meta tratado
 *          pela Edge Function `whatsapp-webhook-meta`. parseWebhook aqui é só
 *          por contrato da interface (não é o caminho real de inbound).
 *
 * Cloud API não tem "sessão"/QR: a conexão é por credenciais. getConnectionState
 * responde 'connected' (token inválido só aparece como erro no envio, igual ao
 * modo evolution_business).
 */
import { toWhatsAppPhone } from '@/lib/phone';
import type {
  WhatsAppProvider,
  ProviderConfig,
  SendTextInput,
  SendMediaInput,
  SendResult,
  QrResult,
  InboundEvent,
  WaConnectionState,
} from './types';

const DEFAULT_GRAPH_VERSION = 'v21.0';

interface MetaSendResponse {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; code?: number; error_data?: { details?: string } };
}

export class MetaCloudProvider implements WhatsAppProvider {
  readonly instanceName: string;
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly graphVersion: string;

  constructor(config: ProviderConfig) {
    this.instanceName = config.instanceName;
    this.token = config.token;
    this.phoneNumberId = (config.phoneNumberId || '').trim();
    this.graphVersion = (process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim();
  }

  private async send(payload: Record<string, unknown>): Promise<SendResult> {
    if (!this.phoneNumberId) return { ok: false, error: 'phone_number_id não configurado' };
    if (!this.token) return { ok: false, error: 'token da Meta não configurado' };

    let res: Response;
    try {
      res = await fetch(
        `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(this.phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
          cache: 'no-store',
        }
      );
    } catch (e) {
      return { ok: false, error: `Falha de rede ao falar com a Meta: ${(e as Error).message}` };
    }

    let data: MetaSendResponse | null = null;
    try {
      data = (await res.json()) as MetaSendResponse;
    } catch {
      data = null;
    }

    if (!res.ok || data?.error) {
      // A Meta detalha o motivo (ex.: fora da janela de 24h precisa de template).
      const err = data?.error;
      const detail = err?.error_data?.details || err?.message || `Meta respondeu ${res.status}`;
      return { ok: false, error: detail, raw: data };
    }
    return { ok: true, providerMessageId: data?.messages?.[0]?.id, raw: data };
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const to = toWhatsAppPhone(input.to);
    if (!to) return { ok: false, error: 'Telefone inválido' };
    return this.send({
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: true, body: input.text },
    });
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const to = toWhatsAppPhone(input.to);
    if (!to) return { ok: false, error: 'Telefone inválido' };
    // A Cloud API baixa a mídia da URL informada (a URL assinada do bucket
    // wa-media é acessível por link enquanto vale). Só imagem/vídeo/documento
    // aceitam legenda; áudio e figurinha não.
    const link = input.media;
    let media: Record<string, unknown>;
    switch (input.kind) {
      case 'audio':
        media = { type: 'audio', audio: { link } };
        break;
      case 'sticker':
        media = { type: 'sticker', sticker: { link } };
        break;
      case 'document':
        media = {
          type: 'document',
          document: {
            link,
            ...(input.caption ? { caption: input.caption } : {}),
            ...(input.fileName ? { filename: input.fileName } : {}),
          },
        };
        break;
      case 'video':
        media = { type: 'video', video: { link, ...(input.caption ? { caption: input.caption } : {}) } };
        break;
      case 'image':
      default:
        media = { type: 'image', image: { link, ...(input.caption ? { caption: input.caption } : {}) } };
        break;
    }
    return this.send({ recipient_type: 'individual', to, ...media });
  }

  // Cloud API é por credenciais, sem sessão/QR.
  async getConnectionState(): Promise<WaConnectionState> {
    return this.phoneNumberId && this.token ? 'connected' : 'disconnected';
  }

  async getQrCode(): Promise<QrResult> {
    return { state: 'connected' };
  }

  // Webhook da Meta é registrado MANUALMENTE no painel do app (URL do CRM).
  async setWebhook(): Promise<void> {
    // no-op
  }

  async logout(): Promise<void> {
    // no-op: não há sessão a derrubar na Cloud API.
  }

  // Não é o caminho real de inbound (isso é a Edge Function whatsapp-webhook-meta),
  // mas o contrato da interface exige o método.
  parseWebhook(): InboundEvent {
    return { kind: 'ignored', reason: 'meta_cloud usa a Edge Function nativa da Meta' };
  }
}
