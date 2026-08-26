-- =============================================================================
-- Agentes de IA: "Ao ser ativado" (pelo chat ou pelo pipeline).
--   speak_first = já manda a primeira mensagem (comportamento de hoje)
--   wait_reply  = fica ativo na conversa e responde à próxima mensagem do contato
-- Aditivo e idempotente.
-- =============================================================================
ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS start_mode TEXT NOT NULL DEFAULT 'speak_first';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_ai_agents_start_mode_check') THEN
    ALTER TABLE public.wa_ai_agents
      ADD CONSTRAINT wa_ai_agents_start_mode_check CHECK (start_mode IN ('speak_first', 'wait_reply'));
  END IF;
END $$;
