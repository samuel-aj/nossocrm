-- =============================================================================
-- Mensagens EDITADAS no WhatsApp
-- =============================================================================
-- ADITIVO e idempotente. A edição chega da Evolution como protocolMessage
-- com editedMessage; antes o webhook a descartava e o CRM ficava com o texto
-- antigo para sempre. Agora o webhook atualiza o corpo da mensagem original e
-- carimba aqui QUANDO ela foi editada (null = nunca editada). O chat mostra o
-- selo "Editada" com a data/hora no hover.

ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

COMMENT ON COLUMN public.wa_messages.edited_at IS
  'quando a mensagem foi editada no WhatsApp (null = nunca); o corpo guarda o texto mais recente';
