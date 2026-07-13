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
}

export interface WaChatData {
  connected: boolean;
  hasConnection: boolean;
  conversation: { id: string; wa_phone: string; wa_name: string | null; contact_id: string | null } | null;
  messages: WaChatMessage[];
}

export type WaMediaKind = 'image' | 'video' | 'document' | 'audio' | 'sticker';

export interface SendChatPayload {
  text?: string;
  file?: File | Blob;
  fileName?: string;
  kind?: WaMediaKind;
}

export function useWhatsAppChat(phoneE164: string | null) {
  const qc = useQueryClient();
  const queryKey = ['waChat', phoneE164] as const;
  // pausa o polling durante um envio: um refetch no meio apagaria a bolha otimista
  const sendingRef = useRef(false);

  const query = useQuery<WaChatData>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/whatsapp/messages?phone=${encodeURIComponent(phoneE164!)}`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao carregar a conversa');
      return json as WaChatData;
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
        body: JSON.stringify({ to: phoneE164, text: p.text || '', media }),
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
      };
      qc.setQueryData<WaChatData>(queryKey, old =>
        old
          ? { ...old, messages: [...old.messages, temp] }
          : { connected: true, hasConnection: true, conversation: null, messages: [temp] }
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
