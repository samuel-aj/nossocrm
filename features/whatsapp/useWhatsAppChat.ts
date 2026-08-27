/**
 * Hook do chat de WhatsApp dentro do card do lead.
 * Carrega a conversa por telefone, envia mensagens (texto e mídia) e mantém
 * atualizado (polling curto — "quase ao vivo"; Realtime pode ser plugado depois).
 *
 * Envio de mídia: o arquivo sobe DIRETO pro Supabase Storage (URL assinada de
 * upload — não passa pela Vercel, que limita o body a ~4,5MB) e o /send recebe
 * só o caminho.
 */
import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { ConversationAiInfo, ConversationBotInfo } from '@/lib/wa-agents/types';
import { snapshotFromMessage, type QuotedSnapshot } from '@/lib/whatsapp/quote';

export type WaQuoted = QuotedSnapshot;

export interface WaChatMessage {
  id: string;
  direction: 'in' | 'out';
  status: string;
  body: string | null;
  media_type: string | null;
  media_mime: string | null;
  media_url: string | null;
  from_phone: string | null;
  to_phone: string | null;
  wa_timestamp: string | null;
  created_at: string;
  sent_by: string | null;
  /** Motivo da falha (Meta/Evolution) quando status === 'failed' */
  error: string | null;
  /** Transcrição do áudio (gerada por IA sob demanda, cacheada no banco) */
  transcription: string | null;
  /** De qual número conectado a mensagem veio (divisórias por número) */
  connection_id?: string | null;
  /** Responder: id (no CRM) da mensagem citada, quando ela existe aqui */
  quoted_message_id?: string | null;
  /** Responder: retrato da mensagem citada (renderiza mesmo sem a original carregada) */
  quoted?: WaQuoted | null;
  /** Mensagem encaminhada */
  forwarded?: boolean;
}

/** Número conectado disponível pra ENVIAR (multi-número). */
export interface WaSender {
  id: string;
  provider: string;
  phoneNumber: string | null;
  profileName: string | null;
}

export interface WaChatData {
  connected: boolean;
  hasConnection: boolean;
  /** Provedor da conexão ('evolution' | 'evolution_business' | 'meta_cloud') — decide fallback de áudio */
  provider: string | null;
  /** Todos os números CONECTADOS da org (seletor de envio do chat) */
  senders: WaSender[];
  conversation: {
    id: string;
    wa_phone: string;
    wa_name: string | null;
    contact_id: string | null;
    /** Última mensagem RECEBIDA do contato (janela de 24 h da API oficial) */
    last_inbound_at?: string | null;
  } | null;
  /** Agente de IA nesta conversa (null = nenhum agente atuou ainda). Externo (API) ou nativo (beta). */
  ai?: ConversationAiInfo | null;
  /** Robô em andamento nesta conversa (null = nenhum) */
  bot?: ConversationBotInfo | null;
  /** Rótulo de TODOS os números da org (inclui desconectados), por id */
  numbers?: Record<string, { phoneNumber: string | null; profileName: string | null }>;
  messages: WaChatMessage[];
}

export type WaMediaKind = 'image' | 'video' | 'document' | 'audio' | 'sticker';

export interface SendChatPayload {
  text?: string;
  file?: File | Blob;
  fileName?: string;
  kind?: WaMediaKind;
  /** Multi-número: qual conexão envia (omitido = a padrão da org) */
  connectionId?: string;
  /** Modelo aprovado da Meta: nome na Meta + idioma + valores dos {{n}} */
  template?: { name: string; language: string; params: string[] };
  /** Responder: a mensagem citada (desta conversa) */
  replyTo?: WaChatMessage;
}

/** Destino de um encaminhamento (telefone + por qual número sai; omitido = padrão da org). */
export interface ForwardTarget {
  phone: string;
  connectionId?: string | null;
}

export interface ForwardResult {
  ok: boolean;
  results: Array<{ phone: string; connectionId: string | null; ok: boolean; sent: number; failed: number; error?: string }>;
}

/** POST /api/whatsapp/forward: reenvia as mensagens (ids) pra cada destino. */
export async function forwardWhatsAppMessages(messageIds: string[], targets: ForwardTarget[]): Promise<ForwardResult> {
  const res = await fetch('/api/whatsapp/forward', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      messageIds,
      targets: targets.map(t => ({ phone: t.phone, ...(t.connectionId ? { connectionId: t.connectionId } : {}) })),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<ForwardResult> & { error?: string };
  if (res.status >= 400) throw new Error(json.error || 'Falha ao encaminhar');
  return { ok: !!json.ok, results: json.results ?? [] };
}

/**
 * connectionId restringe o chat a UM número conectado (conversas separadas por
 * número na página Chats). null/omitido = visão unificada do contato.
 */
export function useWhatsAppChat(phoneE164: string | null, connectionId?: string | null) {
  const qc = useQueryClient();
  const queryKey = ['waChat', phoneE164, connectionId ?? 'all'] as const;
  // pausa o polling durante um envio: um refetch no meio apagaria a bolha otimista
  const sendingRef = useRef(false);

  // URLs de mídia ESTÁVEIS entre polls: a API assina uma URL NOVA a cada
  // consulta (a cada 4s) — se o src trocar, o <video>/<img> recarrega do zero
  // toda hora. Fixamos a primeira URL vista de cada mensagem enquanto a
  // assinatura vale (50min de 1h), depois renovamos.
  const mediaUrlCacheRef = useRef<Map<string, { url: string; ts: number }>>(new Map());
  const MEDIA_URL_FRESH_MS = 50 * 60 * 1000;

  const query = useQuery<WaChatData>({
    queryKey,
    queryFn: async () => {
      const url =
        `/api/whatsapp/messages?phone=${encodeURIComponent(phoneE164!)}` +
        (connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : '');
      const res = await fetch(url, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao carregar a conversa');
      const data = json as WaChatData;
      const cache = mediaUrlCacheRef.current;
      const now = Date.now();
      data.messages = (data.messages || []).map(m => {
        if (!m.media_url) return m;
        const hit = cache.get(m.id);
        if (hit && now - hit.ts < MEDIA_URL_FRESH_MS) {
          return m.media_url === hit.url ? m : { ...m, media_url: hit.url };
        }
        cache.set(m.id, { url: m.media_url, ts: now });
        return m;
      });
      return data;
    },
    enabled: !!phoneE164,
    refetchInterval: () => (!phoneE164 || sendingRef.current ? false : 4000),
    refetchOnWindowFocus: true,
    staleTime: 2000,
  });

  const send = useMutation({
    mutationFn: async (payload: string | SendChatPayload) => {
      const p: SendChatPayload = typeof payload === 'string' ? { text: payload } : payload;

      let media: { path: string; kind: WaMediaKind; mimeType?: string; fileName?: string } | undefined;
      if (p.file && p.kind) {
        const fileName =
          p.fileName || (p.file instanceof File && p.file.name ? p.file.name : `arquivo_${Date.now()}`);
        const mimeType = p.file.type || undefined;

        // 1) pede a URL assinada de upload
        const up = await fetch('/api/whatsapp/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ fileName }),
        });
        const upJson = (await up.json().catch(() => ({}))) as {
          path?: string;
          token?: string;
          error?: string;
        };
        if (!up.ok || !upJson.path || !upJson.token) {
          throw new Error(upJson.error || 'Falha ao preparar o upload');
        }

        // 2) sobe o arquivo direto pro Storage
        const supabase = createClient();
        if (!supabase) throw new Error('Supabase não configurado');
        const { error: upErr } = await supabase.storage
          .from('wa-media')
          .uploadToSignedUrl(upJson.path, upJson.token, p.file, { contentType: mimeType });
        if (upErr) throw new Error(`Upload falhou: ${upErr.message}`);

        media = { path: upJson.path, kind: p.kind, mimeType, fileName };
      }

      // 3) envia (texto e/ou mídia)
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          to: phoneE164,
          text: p.text || '',
          media,
          ...(p.connectionId ? { connectionId: p.connectionId } : {}),
          ...(p.template ? { template: p.template } : {}),
          ...(p.replyTo ? { replyTo: p.replyTo.id } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao enviar');
      return json;
    },
    // Bolha OTIMISTA: a mensagem aparece no instante do Enter (status ⏱) e o
    // servidor confirma por trás — sem esperar round trip + refetch.
    onMutate: async payload => {
      const p: SendChatPayload = typeof payload === 'string' ? { text: payload } : payload;
      sendingRef.current = true;
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<WaChatData>(queryKey);
      const temp: WaChatMessage = {
        id: `temp-${Date.now()}`,
        direction: 'out',
        status: 'queued',
        body: p.text || null,
        media_type: p.file ? (p.kind ?? null) : null,
        media_mime: null,
        media_url: null,
        from_phone: null,
        to_phone: phoneE164,
        wa_timestamp: null,
        created_at: new Date().toISOString(),
        sent_by: null,
        error: null,
        transcription: null,
        // bolha otimista já nasce no número certo (divisória não pisca)
        connection_id: p.connectionId ?? connectionId ?? null,
        // ...e já com a citação, quando é resposta
        quoted_message_id: p.replyTo?.id ?? null,
        quoted: p.replyTo ? snapshotFromMessage(p.replyTo) : null,
        forwarded: false,
      };
      qc.setQueryData<WaChatData>(queryKey, old =>
        old
          ? { ...old, messages: [...old.messages, temp] }
          : { connected: true, hasConnection: true, provider: null, senders: [], conversation: null, messages: [temp] }
      );
      return { previous };
    },
    onError: (_err, _payload, ctx) => {
      // desfaz a bolha otimista; o componente devolve o texto/anexo pro campo
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
    },
    onSettled: () => {
      sendingRef.current = false;
      qc.invalidateQueries({ queryKey });
    },
  });

  return { ...query, send };
}
