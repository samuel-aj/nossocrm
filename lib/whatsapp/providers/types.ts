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
}

export interface SendTextInput {
  /** Telefone do destinatário (E.164 ou só dígitos — o adapter normaliza) */
  to: string;
  text: string;
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
  /** Configura o webhook da instância para apontar para o CRM. */
  setWebhook(url: string): Promise<void>;
  /** Desconecta o número da instância (logout) — a instância continua existindo. */
  logout(): Promise<void>;
  /** Normaliza um payload de webhook do provedor em um InboundEvent. */
  parseWebhook(payload: unknown): InboundEvent;
}
