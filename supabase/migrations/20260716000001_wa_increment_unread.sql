-- Contador de NÃO LIDAS (bolinha estilo WhatsApp na página Chats):
-- incremento ATÔMICO chamado pelo webhook a cada mensagem RECEBIDA.
-- Zera quando a conversa é visualizada (GET /api/whatsapp/messages).
CREATE OR REPLACE FUNCTION public.wa_increment_unread(p_conversation_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.wa_conversations
  SET unread_count = COALESCE(unread_count, 0) + 1
  WHERE id = p_conversation_id;
$$;
