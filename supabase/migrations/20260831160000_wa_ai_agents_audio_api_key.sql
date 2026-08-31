-- =============================================================================
-- Chave da OpenAI só para transcrever áudio
-- =============================================================================
-- ADITIVO. Provedores que não transcrevem áudio (Anthropic) deixavam o agente
-- surdo. Esta chave é opcional e usada SOMENTE na transcrição (whisper-1),
-- independente do provedor do agente. Vazia: cai na chave da OpenAI da
-- organização, e sem nenhuma das duas o áudio segue como "[áudio]".
-- =============================================================================

ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS audio_api_key TEXT;
