/**
 * Hook do chat de WhatsApp dentro do card do lead.
 * Carrega a conversa por telefone, envia mensagens e mantém atualizado
 * (polling curto — "quase ao vivo"; Realtime pode ser plugado depois).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface WaChatMessage {
  id: string;
  direction: 'in' | 'out';
  status: string;
  body: string | null;
  media_type: string | null;
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

export function useWhatsAppChat(phoneE164: string | null) {
  const qc = useQueryClient();
  const queryKey = ['waChat', phoneE164] as const;

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
    refetchInterval: phoneE164 ? 4000 : false,
    refetchOnWindowFocus: true,
    staleTime: 2000,
  });

  const send = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ to: phoneE164, text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Falha ao enviar');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  return { ...query, send };
}
