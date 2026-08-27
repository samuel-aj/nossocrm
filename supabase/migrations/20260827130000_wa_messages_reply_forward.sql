-- Responder (citar) e encaminhar mensagens no chat de WhatsApp.
--
-- quoted_message_id: a mensagem do CRM que esta mensagem responde (quando a
--   original está no banco). FK com SET NULL: apagar a original não apaga a
--   resposta, só perde o "pular para".
-- quoted: retrato da mensagem citada na hora do envio/recebimento
--   { provider_id, body, media_type, direction } — renderiza a citação mesmo
--   que a original não esteja carregada (histórico antigo) ou nem exista no CRM.
-- forwarded: mensagem encaminhada (pelo CRM, ou marcada assim pelo provedor).
--
-- Idempotente; aplicar em produção E staging ANTES de publicar o app e as
-- Edge Functions que gravam essas colunas.
ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS quoted_message_id UUID REFERENCES public.wa_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quoted JSONB,
  ADD COLUMN IF NOT EXISTS forwarded BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wa_messages.quoted_message_id IS 'Mensagem (do CRM) que esta responde/cita; NULL = não é resposta ou a original não está no CRM.';
COMMENT ON COLUMN public.wa_messages.quoted IS 'Retrato da mensagem citada: { provider_id, body, media_type, direction }.';
COMMENT ON COLUMN public.wa_messages.forwarded IS 'true = mensagem encaminhada.';
