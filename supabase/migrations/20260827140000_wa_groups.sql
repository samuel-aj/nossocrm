-- Grupos do WhatsApp no chat (opcional por organização).
--
-- organization_settings.wa_groups_enabled: chave da org (padrão DESLIGADO).
--   Desligada, a Edge Function whatsapp-webhook ignora mensagens de grupo
--   (comportamento de sempre) e a página Chats não lista grupos.
-- wa_conversations.is_group / group_jid / participants_count: a "conversa"
--   é o grupo (wa_phone guarda o JID "...@g.us"); nome do grupo em wa_name.
-- wa_messages.sender_name: em grupo, quem escreveu (nome do WhatsApp); o
--   telefone de quem escreveu fica em from_phone.
--
-- Idempotente; aplicar em produção E staging antes de publicar o app e a
-- Edge Function. Só números conectados por QR Code (Evolution) têm grupos;
-- a API oficial da Meta não tem. Agentes de IA e robôs nunca agem em grupo.
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS wa_groups_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_jid TEXT,
  ADD COLUMN IF NOT EXISTS participants_count INTEGER;

ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS sender_name TEXT;

CREATE INDEX IF NOT EXISTS idx_wa_conversations_group
  ON public.wa_conversations(organization_id) WHERE is_group;

COMMENT ON COLUMN public.organization_settings.wa_groups_enabled IS 'true = grupos do WhatsApp aparecem no chat (só números via QR Code).';
COMMENT ON COLUMN public.wa_conversations.is_group IS 'true = a conversa é um grupo do WhatsApp (wa_phone = JID do grupo).';
COMMENT ON COLUMN public.wa_conversations.group_jid IS 'JID do grupo (...@g.us).';
COMMENT ON COLUMN public.wa_conversations.participants_count IS 'Quantidade de participantes do grupo (informativo).';
COMMENT ON COLUMN public.wa_messages.sender_name IS 'Grupo: nome (WhatsApp) de quem escreveu a mensagem recebida.';
