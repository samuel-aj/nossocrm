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
  SendTemplateInput,
} from './types';

const DEFAULT_GRAPH_VERSION = 'v21.0';

interface MetaSendResponse {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; code?: number; error_data?: { details?: string } };
}

interface MetaMediaUploadResponse {
  id?: string;
  error?: { message?: string; error_data?: { details?: string } };
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

  /** "Responder": a Cloud API cita pela `context.message_id` (wamid da original). */
  private context(quoted?: { providerMessageId: string }): Record<string, unknown> {
    return quoted?.providerMessageId ? { context: { message_id: quoted.providerMessageId } } : {};
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const to = toWhatsAppPhone(input.to);
    if (!to) return { ok: false, error: 'Telefone inválido' };
    return this.send({
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: true, body: input.text },
      ...this.context(input.quoted),
    });
  }

  /** Modelo aprovado: único jeito de iniciar conversa fora da janela de 24h. */
  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    const to = toWhatsAppPhone(input.to);
    if (!to) return { ok: false, error: 'Telefone inválido' };
    return this.send({
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: input.name,
        language: { code: input.language || 'pt_BR' },
        ...(input.components?.length ? { components: input.components } : {}),
      },
    });
  }

  /**
   * Sobe a mídia pra Meta (POST /{phone_number_id}/media) e devolve o media id.
   * MUITO mais confiável que mandar link: a Meta valida o ARQUIVO na hora e
   * devolve o motivo exato se recusar (formato, tamanho...), em vez de baixar
   * o link depois, "adivinhar" o tipo e falhar em silêncio no recibo.
   */
  private async uploadMedia(input: SendMediaInput): Promise<{ id?: string; error?: string }> {
    let dl: Response;
    try {
      dl = await fetch(input.media, { cache: 'no-store' });
    } catch (e) {
      return { error: `Falha ao ler a mídia do storage: ${(e as Error).message}` };
    }
    if (!dl.ok) return { error: `Falha ao ler a mídia do storage (HTTP ${dl.status})` };
    const bytes = await dl.arrayBuffer();

    // Content-type LIMPO (sem ";codecs=..." — a Meta rejeita parâmetros).
    const contentType = (input.mimeType || dl.headers.get('content-type') || 'application/octet-stream')
      .split(';')[0]
      .trim();

    // Áudio webm = gravação crua do Chrome, que a Meta recusa na certa. Só
    // chega aqui se o navegador estiver numa versão ANTIGA do CRM (sem o
    // conversor de MP3) — corta antes de subir, com instrução clara.
    if (input.kind === 'audio' && /webm/i.test(contentType)) {
      return {
        error:
          'o áudio saiu no formato webm, que o WhatsApp recusa. A página do CRM está numa versão antiga: atualize com Ctrl+Shift+R e grave de novo.',
      };
    }

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', contentType);
    form.append('file', new Blob([bytes], { type: contentType }), input.fileName || 'arquivo');

    let res: Response;
    try {
      res = await fetch(
        `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(this.phoneNumberId)}/media`,
        { method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, body: form, cache: 'no-store' }
      );
    } catch (e) {
      return { error: `Falha de rede ao subir a mídia pra Meta: ${(e as Error).message}` };
    }
    let data: MetaMediaUploadResponse | null = null;
    try {
      data = (await res.json()) as MetaMediaUploadResponse;
    } catch {
      data = null;
    }
    if (!res.ok || !data?.id) {
      const err = data?.error;
      return { error: err?.error_data?.details || err?.message || `Meta recusou a mídia (HTTP ${res.status})` };
    }
    return { id: data.id };
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const to = toWhatsAppPhone(input.to);
    if (!to) return { ok: false, error: 'Telefone inválido' };

    // Upload primeiro (validação imediata) e envio por media ID — sem depender
    // da Meta baixar link. Só imagem/vídeo/documento aceitam legenda.
    const up = await this.uploadMedia(input);
    if (!up.id) return { ok: false, error: up.error || 'Falha ao subir a mídia pra Meta' };
    const id = up.id;

    let media: Record<string, unknown>;
    switch (input.kind) {
      case 'audio':
        media = { type: 'audio', audio: { id } };
        break;
      case 'sticker':
        media = { type: 'sticker', sticker: { id } };
        break;
      case 'document':
        media = {
          type: 'document',
          document: {
            id,
            ...(input.caption ? { caption: input.caption } : {}),
            ...(input.fileName ? { filename: input.fileName } : {}),
          },
        };
        break;
      case 'video':
        media = { type: 'video', video: { id, ...(input.caption ? { caption: input.caption } : {}) } };
        break;
      case 'image':
      default:
        media = { type: 'image', image: { id, ...(input.caption ? { caption: input.caption } : {}) } };
        break;
    }
    return this.send({ recipient_type: 'individual', to, ...media, ...this.context(input.quoted) });
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
