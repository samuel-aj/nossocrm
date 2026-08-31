-- =============================================================================
-- Robô em vários números + contexto de IA no negócio + leitura da descrição
-- =============================================================================
-- Tudo ADITIVO, com padrão igual ao comportamento de hoje.
--
-- 1. wa_bots.connection_ids: os números em que o robô PODE agir (antes era um
--    número só, e ainda assim o envio saía pelo número da conversa). Migra o
--    connection_id atual para a lista; a coluna antiga continua existindo para
--    não quebrar nada que ainda a leia.
-- 2. wa_ai_agents.lead_context: o que do cadastro entra no prompt (hoje a
--    descrição já entra, então o padrão é true).
-- 3. deals.ai_context: contexto escrito pela integração ao cadastrar o lead,
--    que o agente lê quando entrar na conversa (mesmo que ninguém o ative agora).
-- =============================================================================

ALTER TABLE public.wa_bots
  ADD COLUMN IF NOT EXISTS connection_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE public.wa_bots
   SET connection_ids = ARRAY[connection_id]
 WHERE connection_id IS NOT NULL
   AND (connection_ids IS NULL OR cardinality(connection_ids) = 0);

CREATE INDEX IF NOT EXISTS wa_bots_conn_gin ON public.wa_bots USING GIN (connection_ids);

ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS lead_context JSONB NOT NULL DEFAULT '{"description": true, "custom_fields": true}'::jsonb;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS ai_context TEXT;

COMMENT ON COLUMN public.deals.ai_context IS
  'Contexto para o agente de IA sobre este lead (API pública: ai_context). Entra no prompt como "contexto informado pela equipe".';
