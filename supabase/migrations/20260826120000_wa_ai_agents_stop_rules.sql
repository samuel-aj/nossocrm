-- =============================================================================
-- Agentes de IA (beta): regras de encerramento (stop_rules), teto de respostas
-- por atendimento (max_replies) e mensagem recebida em conversa PARADA voltando
-- a chamar o app só por palavra-chave. Tudo aditivo e idempotente.
-- =============================================================================

ALTER TABLE public.wa_ai_agents
  -- regras explícitas de quando o agente encerra (bloco "QUANDO ENCERRAR" do prompt)
  ADD COLUMN IF NOT EXISTS stop_rules TEXT NOT NULL DEFAULT '',
  -- teto de respostas do agente por atendimento (0 = sem limite): ao atingir, manda a mensagem final e encerra
  ADD COLUMN IF NOT EXISTS max_replies INTEGER NOT NULL DEFAULT 0;

-- teto entre 0 e 500 (mesma faixa do esquema zod); recriado para ficar idempotente
ALTER TABLE public.wa_ai_agents DROP CONSTRAINT IF EXISTS wa_ai_agents_max_replies_check;
ALTER TABLE public.wa_ai_agents
  ADD CONSTRAINT wa_ai_agents_max_replies_check CHECK (max_replies >= 0 AND max_replies <= 500);

-- -----------------------------------------------------------------------------
-- Mensagem RECEBIDA -> ingest.
-- Conversa com agente nativo só chama o app quando está ativa (pausada ou
-- aguardando aprovação não gera invocação nem execução 'skipped').
-- Conversa PARADA pelo próprio agente (ai_status = 'stopped' e ai_paused_by
-- nulo) e conversa de agente EXTERNO ativo (n8n via API: ai_status = 'active'
-- sem ai_agent_id) voltam a chamar o app apenas se algum agente do número tiver
-- gatilho por palavra-chave: a palavra-chave é o gatilho explícito que reabre
-- (ou assume) o atendimento. Parada pelo ATENDENTE (ai_paused_by preenchido)
-- nunca é reaberta automaticamente. O modo "qualquer mensagem" continua valendo
-- só para conversa sem estado. Quem confere se o texto contém a palavra-chave é
-- o app (pickInboundAgent com keywordsOnly).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_agent_ingest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE conv RECORD; should BOOLEAN := false;
BEGIN
  IF NEW.direction <> 'in' THEN RETURN NEW; END IF;
  IF NOT public.wa_agents_beta_enabled(NEW.organization_id) THEN RETURN NEW; END IF;

  SELECT id, connection_id, ai_agent_id, ai_status, ai_paused_by INTO conv
    FROM public.wa_conversations WHERE id = NEW.conversation_id;
  IF conv.id IS NULL THEN RETURN NEW; END IF;

  IF conv.ai_agent_id IS NOT NULL AND COALESCE(conv.ai_status, 'active') = 'active' THEN
    should := true;
  ELSIF conv.connection_id IS NOT NULL AND (
      conv.ai_status IS NULL
      OR (conv.ai_status = 'stopped' AND conv.ai_paused_by IS NULL)   -- parada pelo próprio agente
      OR (conv.ai_status = 'active' AND conv.ai_agent_id IS NULL)     -- agente externo ativo
    ) AND EXISTS (
    SELECT 1 FROM public.wa_ai_agents a
    WHERE a.organization_id = NEW.organization_id AND a.enabled = true AND conv.connection_id = ANY(a.connection_ids)
      AND COALESCE(a.triggers->'inbound'->>'mode', 'any') <> 'none'
      -- conversa parada ou de agente externo: só agente com gatilho por palavra-chave
      AND (conv.ai_status IS NULL OR a.triggers->'inbound'->>'mode' = 'keywords')
  ) THEN
    should := true;
  END IF;
  IF NOT should AND EXISTS (
    SELECT 1 FROM public.wa_bot_runs r WHERE r.conversation_id = conv.id AND r.status = 'waiting_reply'
  ) THEN
    should := true;
  END IF;

  IF should THEN
    PERFORM public.wa_agents_call_app(
      '/api/wa-agents/ingest',
      jsonb_build_object('organization_id', NEW.organization_id, 'conversation_id', NEW.conversation_id, 'message_id', NEW.id)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_ai_agent_ingest falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;
