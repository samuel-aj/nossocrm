-- =============================================================================
-- Foto de perfil do contato / do grupo na lista de conversas
-- =============================================================================
-- ADITIVO. `avatar_path` guarda o CAMINHO no bucket privado wa-media (mesmo
-- padrão de wa_messages.media_url): a URL é assinada na leitura, porque a URL
-- que o provedor devolve expira em poucas horas e a foto sumiria da tela.
--
-- `avatar_synced_at` evita ficar buscando a mesma foto a cada abertura da
-- lista; a rotina só volta no provedor depois de alguns dias.
--
-- Só vale para número por QR Code: a API oficial da Meta NÃO expõe a foto de
-- quem conversa com a empresa (o webhook manda só o nome). Nesses números a
-- coluna fica nula e a lista segue mostrando as iniciais.
-- =============================================================================

ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS avatar_path TEXT,
  ADD COLUMN IF NOT EXISTS avatar_synced_at TIMESTAMPTZ;
