-- =============================================================================
-- Mídia recebida entendida pelo agente (áudio, imagem, figurinha, documento)
-- =============================================================================
-- ADITIVO. O agente passa a transformar em texto, com a PRÓPRIA IA dele, o que
-- o lead manda em mídia, gravando em wa_messages.transcription (que já era o
-- campo lido pelo motor e pelo chat). Ligado por padrão; dá para desligar por
-- tipo na configuração do agente.
-- =============================================================================

ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS media_understanding JSONB NOT NULL
  DEFAULT '{"audio": true, "image": true, "document": true}'::jsonb;
