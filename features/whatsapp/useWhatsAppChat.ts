/**
 * Hook do chat de WhatsApp dentro do card do lead.
 * Carrega a conversa por telefone, envia mensagens (texto e mídia) e mantém
 * atualizado (polling curto — "quase ao vivo"; Realtime pode ser plugado depois).
 *
 * Envio de mídia: o arquivo sobe DIRETO pro Supabase Storage (URL assinada de
 * upload — não passa pela Vercel, que limita o body a ~4,5MB) e o /send recebe
 * só o caminho.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /** Nome (perfil) de quem enviou pelo CRM; null nas demais origens */
  sent_by_name?: string | null;
  /** Por onde a mensagem saiu: 'crm' | 'bot' | 'agent' | 'api' | 'echo' (celular) */
  source?: string | null;
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
  /** GRUPO: nome (WhatsApp) de quem escreveu a mensagem recebida */
  sender_name?: string | null;
  /** Quando a mensagem foi EDITADA no WhatsApp (null = nunca); body já traz o texto novo */
  edited_at?: string | null;
  original_body?: string | null;
  can_edit?: boolean;
  deleted_at?: string | null;
  can_delete?: boolean;
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
    /** GRUPO do WhatsApp (a conversa é o grupo) */
    is_group?: boolean;
    group_jid?: string | null;
    participants_count?: number | null;
    group_invite_link?: string | null;
    connection_id?: string | null;
  } | null;
  /** Agente de IA nesta conversa (null = nenhum agente atuou ainda). Externo (API) ou nativo (beta). */
  ai?: ConversationAiInfo | null;
  /** Robô em andamento nesta conversa (null = nenhum) */
  bot?: ConversationBotInfo | null;
  /** Rótulo de TODOS os números da org (inclui desconectados), por id */
  numbers?: Record<string, { phoneNumber: string | null; profileName: string | null }>;
  messages: WaChatMessage[];
  /** Há mensagens mais antigas que as carregadas (rolar para cima busca a página anterior) */
  hasMore?: boolean;
}

export type WaMediaKind = 'image' | 'video' | 'document' | 'audio' | 'sticker';

export interface SendChatPayload {
  mentions?: import('@/lib/whatsapp/groupParticipants').GroupMention[];
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
  /** GRUPO: destino pelo id da conversa (grupo não tem telefone) */
  conversationId?: string | null;
}

export interface ForwardResult {
  ok: boolean;
  results: Array<{
    phone: string;
    connectionId: string | null;
    conversationId?: string | null;
    ok: boolean;
    sent: number;
    failed: number;
    error?: string;
  }>;
}

/** POST /api/whatsapp/forward: reenvia as mensagens (ids) pra cada destino. */
export async function forwardWhatsAppMessages(messageIds: string[], targets: ForwardTarget[]): Promise<ForwardResult> {
  const res = await fetch('/api/whatsapp/forward', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      messageIds,
      targets: targets.map(t => ({
        phone: t.phone,
        ...(t.connectionId ? { connectionId: t.connectionId } : {}),
        ...(t.conversationId ? { conversationId: t.conversationId } : {}),
      })),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<ForwardResult> & { error?: string };
  if (res.status >= 400) throw new Error(json.error || 'Falha ao encaminhar');
  return { ok: !!json.ok, results: json.results ?? [] };
}

/**
 * connectionId restringe o chat a UM número conectado (conversas separadas por
 * número na página Chats). null/omitido = visão unificada do contato.
 * conversationId = GRUPO do WhatsApp (a conversa é o grupo; sem telefone).
 */
export function useWhatsAppChat(phoneE164: string | null, connectionId?: string | null, conversationId?: string | null) {
  const qc = useQueryClient();
  const queryKey = ['waChat', conversationId ? `conv:${conversationId}` : phoneE164, connectionId ?? 'all'] as const;
  const hasTarget = !!phoneE164 || !!conversationId;
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
      const url = conversationId
        ? `/api/whatsapp/messages?conversationId=${encodeURIComponent(conversationId)}`
        : `/api/whatsapp/messages?phone=${encodeURIComponent(phoneE164!)}` +
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
    enabled: hasTarget,
    refetchInterval: () => (!hasTarget || sendingRef.current ? false : 4000),
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
          to: phoneE164 ?? '',
          text: p.text || '',
          ...(p.mentions?.length ? { mentions: p.mentions } : {}),
          media,
          // grupo: o destino é a conversa (o servidor resolve o JID do grupo)
          ...(conversationId ? { conversationId } : {}),
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
        // a bolha otimista já nasce com a origem certa (o refetch confirma)
        source: 'crm',
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

  const edit = useMutation({
    mutationFn: async (input: { messageId: string; text: string }) => {
      const res = await fetch('/api/whatsapp/edit', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Não foi possível editar a mensagem.');
      return result as { id: string; body: string; edited_at?: string; original_body?: string | null };
    },
    onSuccess: async result => {
      await qc.cancelQueries({ queryKey: ['waChat'] });
      qc.setQueriesData<WaChatData>({ queryKey: ['waChat'] }, old => old && ({ ...old,
        messages: old.messages.map(message => message.id === result.id
          ? { ...message, body: result.body, original_body: result.original_body ?? message.original_body, ...(result.edited_at ? { edited_at: result.edited_at } : {}) } : message),
      }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['waChat'] });
      void qc.invalidateQueries({ queryKey: ['waConversations'] });
    },
  });

  const remove = useMutation({
    mutationFn: async (input: { messageId: string }) => {
      const response = await fetch('/api/whatsapp/delete', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível excluir a mensagem.');
      return result as { id: string; deleted_at: string };
    },
    onSuccess: async result => {
      await qc.cancelQueries({ queryKey: ['waChat'] });
      qc.setQueriesData<WaChatData>({ queryKey: ['waChat'] }, old => old && ({ ...old,
        messages: old.messages.map(message => message.id === result.id
          ? { ...message, deleted_at: result.deleted_at, can_edit: false, can_delete: false } : message),
      }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['waChat'] });
      void qc.invalidateQueries({ queryKey: ['waConversations'] });
    },
  });
  return { ...query, send, edit, remove };
}

/**
 * Histórico ANTERIOR às mensagens mais recentes (que o polling mantém): rolar
 * para cima busca páginas com ?before=. Mensagens que saem da janela recente
 * (chegaram muitas novas) são guardadas aqui para não abrir buraco no meio.
 */
export function useOlderWhatsAppMessages(
  target: { phone: string | null; connectionId?: string | null; conversationId?: string | null },
  latest: WaChatMessage[],
  latestHasMore: boolean
) {
  const key = `${target.conversationId ?? ''}|${target.phone ?? ''}|${target.connectionId ?? ''}`;
  const [older, setOlder] = useState<WaChatMessage[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(key);
  const prevLatestRef = useRef<WaChatMessage[]>([]);

  useEffect(() => {
    keyRef.current = key;
    setOlder([]);
    setOlderHasMore(null);
    setError(null);
    prevLatestRef.current = [];
  }, [key]);

  // Mensagens que saíram da janela recente continuam visíveis (só depois de já
  // ter paginado; sem isso a janela recente é a conversa inteira que aparece).
  useEffect(() => {
    const prev = prevLatestRef.current;
    prevLatestRef.current = latest;
    if (olderHasMore === null || prev.length === 0 || latest.length === 0) return;
    const ids = new Set(latest.map(m => m.id));
    const oldest = Date.parse(latest[0].created_at);
    const dropped = prev.filter(m => !ids.has(m.id) && Date.parse(m.created_at) < oldest && !m.id.startsWith('tmp'));
    if (dropped.length) setOlder(o => [...o, ...dropped.filter(d => !o.some(x => x.id === d.id))]);
  }, [latest, olderHasMore]);

  const messages = useMemo(() => {
    if (older.length === 0) return latest;
    const ids = new Set(latest.map(m => m.id));
    const merged = older.filter(m => !ids.has(m.id)).concat(latest);
    return merged.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  }, [older, latest]);

  const hasOlder = olderHasMore ?? latestHasMore;

  const loadOlder = useCallback(async () => {
    if (loading || !hasOlder || messages.length === 0) return;
    if (!target.phone && !target.conversationId) return;
    const myKey = keyRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (target.conversationId) params.set('conversationId', target.conversationId);
      else params.set('phone', target.phone!);
      if (target.connectionId) params.set('connectionId', target.connectionId);
      params.set('before', messages[0].created_at);
      const res = await fetch(`/api/whatsapp/messages?${params}`, { credentials: 'include', headers: { accept: 'application/json' } });
      const json = (await res.json().catch(() => ({}))) as { messages?: WaChatMessage[]; hasMore?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || 'Falha ao carregar mensagens anteriores');
      if (keyRef.current !== myKey) return;
      const page = json.messages ?? [];
      setOlder(o => {
        const ids = new Set(o.map(m => m.id));
        return [...page.filter(m => !ids.has(m.id)), ...o];
      });
      setOlderHasMore(!!json.hasMore);
    } catch (e) {
      if (keyRef.current === myKey) setError((e as Error).message);
    } finally {
      if (keyRef.current === myKey) setLoading(false);
    }
  }, [loading, hasOlder, messages, target.phone, target.conversationId, target.connectionId]);

  return { messages, loadOlder, loadingOlder: loading, hasOlder, olderError: error };
}
