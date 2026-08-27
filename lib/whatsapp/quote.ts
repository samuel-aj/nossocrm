/**
 * Responder (citar) mensagens no chat de WhatsApp: tipos e helpers PUROS,
 * compartilhados entre servidor (rotas/service) e navegador (bolhas, barra
 * de resposta). Nada de Supabase aqui.
 */

/** Retrato da mensagem citada, gravado em wa_messages.quoted (JSONB). */
export interface QuotedSnapshot {
  /** id da mensagem citada no provedor (stanzaId / wamid); null quando desconhecido */
  provider_id: string | null;
  /** texto (ou legenda) da mensagem citada */
  body: string | null;
  /** image | video | audio | document | sticker | contact | null */
  media_type: string | null;
  /** 'out' = a citada foi enviada pelo número do CRM; 'in' = pelo contato */
  direction: 'in' | 'out' | null;
}

/** Forma mínima de uma mensagem do chat pra virar citação. */
export interface QuotableMessage {
  body?: string | null;
  media_type?: string | null;
  direction: 'in' | 'out';
  evolution_message_id?: string | null;
}

const MEDIA_QUOTE_LABEL: Record<string, string> = {
  image: '📷 Foto',
  video: '🎥 Vídeo',
  audio: '🎤 Áudio',
  document: '📄 Documento',
  sticker: '🧩 Figurinha',
  contact: '👤 Contato',
};

/** Monta o retrato a partir de uma mensagem do CRM. */
export function snapshotFromMessage(m: QuotableMessage): QuotedSnapshot {
  return {
    provider_id: m.evolution_message_id ?? null,
    body: m.body ?? null,
    media_type: m.media_type ?? null,
    direction: m.direction,
  };
}

/**
 * Texto curto que representa a citação (barra "Respondendo a", bloco na
 * bolha e o `conversation` enviado à Evolution): legenda/texto quando há,
 * senão o rótulo do tipo de mídia.
 */
export function quotedPreviewText(q: Pick<QuotedSnapshot, 'body' | 'media_type'> | null | undefined): string {
  if (!q) return 'Mensagem';
  const body = (q.body ?? '').trim();
  const label = q.media_type ? MEDIA_QUOTE_LABEL[q.media_type] ?? `[${q.media_type}]` : '';
  if (q.media_type === 'contact') {
    // cartão de contato: body = "nome\ntelefone"
    const name = body.split('\n')[0]?.trim();
    return name ? `${label}: ${name}` : label;
  }
  if (body && label) return `${label} · ${body}`;
  if (body) return body;
  if (label) return label;
  return 'Mensagem';
}

/** Limita o texto da citação (o WhatsApp mesmo corta a prévia). */
export function clampQuote(text: string, max = 300): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Tipo de mídia (wa_messages.media_type) -> tipo de ENVIO do provedor.
 * 'contact' e outros sem arquivo não têm equivalente de envio (vão como texto).
 */
export function outboundKindFromMediaType(
  mediaType: string | null | undefined
): 'image' | 'video' | 'document' | 'audio' | 'sticker' | null {
  switch (mediaType) {
    case 'image':
    case 'video':
    case 'document':
    case 'audio':
    case 'sticker':
      return mediaType;
    default:
      return null;
  }
}
