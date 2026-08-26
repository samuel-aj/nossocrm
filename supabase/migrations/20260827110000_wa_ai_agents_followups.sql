-- =============================================================================
-- Agentes de IA: régua de follow-ups por tempo sem resposta do lead.
--   followups = [{ id, after_minutes, kind: 'agent' | 'bot', instruction, bot_id, only_in_window }]
-- Robôs ganham o tipo de gatilho 'agent_followup' (jsonb wa_bots.trigger, sem constraint).
-- O relógio é o tick de 30 s (processFollowups). Aditivo e idempotente.
-- =============================================================================
ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS followups JSONB NOT NULL DEFAULT '[]'::jsonb;
