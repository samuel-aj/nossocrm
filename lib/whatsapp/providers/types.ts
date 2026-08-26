/**
 * Interface comum de provedor de WhatsApp.
 *
 * O CRM fala SEMPRE com esta interface — a implementação concreta (Evolution,
 * e no futuro Z-API/Meta/etc.) fica isolada num adapter. Trocar de provedor =
 * escrever outro adapter, sem tocar nas rotas/UI.
 */

export type WaConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface ProviderConfig {
  /** Base URL do servidor (ex.: https://evo2.anunciojuridico.com.br) — sem /manager */
  baseUrl: string;
  /** Nome da instância no provedor (ex.: "mpl_advogados") */
  instanceName: string;
  /** apikey/token usado no header das chamadas (token da instância ou global) */
  token: string;
  /** Só meta_cloud: phone_number_id da Meta (destino do POST /{id}/messages). */
  phoneNumberId?: string | null;
}

export interface SendTextInput {
  /** Telefone do destinatário (E.164 ou só dígitos — o adapter normaliza) */
  to: string;
  text: string;
}

export type OutboundMediaKind = 'image' | 'video' | 'document' | 'audio' | 'sticker';

export interface SendMediaInput {
  to: string;
  /** URL (pública/assinada) OU base64 do arquivo */
  media: string;
  kind: OutboundMediaKind;
  mimeType?: string;
  /** Nome exibido (documentos) */
  fileName?: string;
  /** Legenda (imagem/vídeo/documento) */
  caption?: string;
}

export interface SendTemplateInput {
  to: string;
  /** Nome do modelo aprovado na Meta */
  name: string;
  /** Código do idioma do modelo (ex.: pt_BR) */
  language: string;
  /** Componentes no formato da Meta (header/body/buttons) */
  components?: unknown[];
}

export interface SendResult {
  ok: boolean;
  /** id da mensagem no provedor (usado p/ idempotência + atualização de status) */
  providerMessageId?: string;
  error?: string;
  raw?: unknown;
}

export interface QrResult {
  state: WaConnectionState;
  /** QR como data URI / base64 pronto p/ <img src> (quando desconectado) */
  qrBase64?: string;
  /** código de pareamento alternativo ao QR */
  pairingCode?: string;
}

/** Mensagem recebida já normalizada (independente do formato do provedor). */
export interface NormalizedInboundMessage {
  providerMessageId: string;
  /** E.164 do outro lado da conversa (o cliente) */
  fromPhone: string;
  toPhone?: string;
  /** true = enviada pelo próprio número conectado (eco de envio) */
  fromMe: boolean;
  pushName?: string;
  text?: string;
  mediaType?: string;
  mediaUrl?: string;
  mediaMime?: string;
  /** ISO 8601 */
  timestamp?: string;
}

/** Evento de webhook já normalizado para um dos tipos que o CRM trata. */
export type InboundEvent =
  | { kind: 'message'; message: NormalizedInboundMessage }
  | { kind: 'status'; providerMessageId: string; status: 'sent' | 'delivered' | 'read' | 'failed' }
  | { kind: 'connection'; state: WaConnectionState }
  | { kind: 'qrcode'; qrBase64?: string }
  | { kind: 'ignored'; reason?: string };

export interface WhatsAppProvider {
  readonly instanceName: string;
  /** Estado atual da conexão da instância. */
  getConnectionState(): Promise<WaConnectionState>;
  /** Inicia/obtém o QR para conectar o número. */
  getQrCode(): Promise<QrResult>;
  /** Envia uma mensagem de texto. */
  sendText(input: SendTextInput): Promise<SendResult>;
  /** Envia mídia: imagem, vídeo, documento, áudio (voz) ou figurinha. */
  sendMedia(input: SendMediaInput): Promise<SendResult>;
  /** Envia um modelo aprovado (só API oficial da Meta; fora da janela de 24h). */
  sendTemplate?(input: SendTemplateInput): Promise<SendResult>;
  /** Configura o webhook da instância para apontar para o CRM. */
  setWebhook(url: string): Promise<void>;
  /** Desconecta o número da instância (logout) — a instância continua existindo. */
  logout(): Promise<void>;
  /** Reinicia a sessão da instância sem perder o pareamento (sessão "aberta" mas morta). */
  restart?(): Promise<void>;
  /** Normaliza um payload de webhook do provedor em um InboundEvent. */
  parseWebhook(payload: unknown): InboundEvent;
}
