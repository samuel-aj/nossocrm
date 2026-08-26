-- =============================================================================
-- Agentes de IA (beta): conversa PARADA nunca é reaberta por gatilho automático.
-- Regra do produto: quem já foi atendido pela IA (ou teve o agente parado pelo
-- atendente) só volta a ser atendido se alguém, na mão, limpar a memória e/ou
-- iniciar um agente pelo chat. Palavra-chave e pipeline valem só para conversa
-- sem estado (ai_status nulo) e, por palavra-chave, para conversa de agente
-- externo ativo (n8n via API), que o agente nativo assume.
-- Idempotente (CREATE OR REPLACE).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.wa_ai_agent_ingest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE conv RECORD; should BOOLEAN := false;
BEGIN
  IF NEW.direction <> 'in' THEN RETURN NEW; END IF;
  IF NOT public.wa_agents_beta_enabled(NEW.organization_id) THEN RETURN NEW; END IF;

  SELECT id, connection_id, ai_agent_id, ai_status INTO conv
    FROM public.wa_conversations WHERE id = NEW.conversation_id;
  IF conv.id IS NULL THEN RETURN NEW; END IF;

  IF conv.ai_agent_id IS NOT NULL AND COALESCE(conv.ai_status, 'active') = 'active' THEN
    should := true;
  ELSIF conv.connection_id IS NOT NULL AND (
      conv.ai_status IS NULL
      OR (conv.ai_status = 'active' AND conv.ai_agent_id IS NULL)     -- agente externo ativo
    ) AND EXISTS (
    SELECT 1 FROM public.wa_ai_agents a
    WHERE a.organization_id = NEW.organization_id AND a.enabled = true AND conv.connection_id = ANY(a.connection_ids)
      AND COALESCE(a.triggers->'inbound'->>'mode', 'any') <> 'none'
      -- conversa de agente externo: só agente com gatilho por palavra-chave
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
