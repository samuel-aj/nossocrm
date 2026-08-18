-- Conversas de WhatsApp separadas POR NÚMERO CONECTADO.
--
-- Antes: uma conversa por telefone na org (uq_wa_conversations_org_phone) —
-- cliente que falava com dois números da org caía numa conversa só, misturando
-- os históricos. Agora cada número conectado é um "WhatsApp" próprio: a
-- unicidade passa a ser (org, conexão, telefone).
--
-- Conversas legadas com connection_id NULL continuam válidas: o webhook as
-- REIVINDICA (seta connection_id) na primeira mensagem que chegar. NULLs são
-- distintos na unicidade de propósito: conexão excluída faz SET NULL nas
-- conversas dela (FK), e duas órfãs do mesmo telefone não podem travar o DELETE.
ALTER TABLE public.wa_conversations
  DROP CONSTRAINT uq_wa_conversations_org_phone;
ALTER TABLE public.wa_conversations
  ADD CONSTRAINT uq_wa_conversations_org_conn_phone
  UNIQUE (organization_id, connection_id, wa_phone);
