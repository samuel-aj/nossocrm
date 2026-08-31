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

/**
 * Mensagem CITADA numa resposta (estilo "responder" do WhatsApp). A Evolution
 * monta o `quoted` (key + message) e a Cloud API da Meta o `context.message_id`.
 */
export interface QuotedRef {
  /** id da mensagem citada no provedor (stanzaId da Evolution / wamid da Meta) */
  providerMessageId: string;
  /** true = a mensagem citada foi enviada pelo próprio número conectado */
  fromMe: boolean;
  /** telefone do interlocutor (E.164) — vira o remoteJid da citação na Evolution */
  remotePhone: string;
  /** JID completo do chat (grupo: "...@g.us"); quando informado, remotePhone é ignorado */
  remoteJid?: string;
  /** Grupo: telefone (E.164) de quem escreveu a mensagem citada (vira `participant`) */
  participantPhone?: string;
  /** prévia curta da citação (a Evolution/Baileys renderiza a partir dela) */
  text?: string;
}

export interface SendTextInput {
  /** Telefone do destinatário (E.164 ou só dígitos — o adapter normaliza) */
  to: string;
  text: string;
  /** Responder: mensagem citada (omitido = mensagem comum) */
  quoted?: QuotedRef;
  /** GRUPO: `to` é o id do grupo (Meta: recipient_type "group"; Evolution: JID "...@g.us") */
  isGroup?: boolean;
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
  /** Responder: mensagem citada (omitido = mensagem comum) */
  quoted?: QuotedRef;
  /** GRUPO: `to` é o id do grupo */
  isGroup?: boolean;
}

export interface SendTemplateInput {
  to: string;
  /** GRUPO: `to` é o id do grupo (só Meta) */
  isGroup?: boolean;
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
  /** Responder: a mensagem que esta cita (id no provedor + prévia), quando houver */
  quoted?: { providerMessageId: string; text?: string; mediaType?: string };
  /** Mensagem marcada como encaminhada pelo provedor */
  forwarded?: boolean;
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
  /**
   * Mostra "digitando..." para o contato por `ms` (best-effort; provedores sem
   * suporte ignoram).
   *
   * `providerMessageId` = id da ÚLTIMA mensagem recebida do contato. A Cloud
   * API da Meta não tem presença avulsa: o "digitando" viaja junto com a
   * marcação de lido de uma mensagem específica, então sem esse id ela não
   * consegue mostrar nada. O QR (Evolution) ignora o campo e usa só `to`.
   */
  sendTyping?(input: { to: string; ms: number; providerMessageId?: string }): Promise<void>;
  /** Marca a mensagem recebida como LIDA (os dois tiques azuis) — best-effort. */
  markRead?(input: { to: string; providerMessageId: string }): Promise<void>;
  /**
   * URL da foto de perfil do contato (ou do grupo, passando o JID). null
   * quando a pessoa não tem foto ou esconde de quem não é contato.
   *
   * Só o QR Code implementa: a Cloud API da Meta NÃO expõe a foto de quem
   * conversa com a empresa (no webhook vem só o nome), então lá o método
   * nem existe e a lista fica nas iniciais.
   */
  fetchProfilePictureUrl?(input: { to: string }): Promise<string | null>;
  /** Normaliza um payload de webhook do provedor em um InboundEvent. */
  parseWebhook(payload: unknown): InboundEvent;
}
