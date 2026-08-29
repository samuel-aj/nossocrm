-- =============================================================================
-- "Digitando..." do agente de IA (tempo pelo tamanho da mensagem)
-- =============================================================================
-- ADITIVO. Coluna nova com padrão DESLIGADO: agentes existentes continuam
-- enviando como hoje até alguém ligar na tela.
--
--   { "enabled": false,          liga a presença "digitando" antes de cada linha
--     "ms_per_char": 45,         velocidade (ms por caractere)
--     "min_ms": 800,             piso por linha
--     "max_ms": 8000 }           teto por linha
-- =============================================================================

ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS typing JSONB NOT NULL
  DEFAULT '{"enabled": false, "ms_per_char": 45, "min_ms": 800, "max_ms": 8000}'::jsonb;
